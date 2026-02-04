import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { applyMigration } from "./setup.ts";
import type { QueueMessage } from "@ronbun/types";
import type { RonbunContext } from "@ronbun/api";

// Mock @ronbun/arxiv external fetch functions
vi.mock("@ronbun/arxiv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ronbun/arxiv")>();
  return {
    ...actual,
    fetchArxivMetadata: vi.fn().mockResolvedValue({
      title: "Test Paper: A Novel Approach",
      authors: ["Alice Smith", "Bob Jones"],
      abstract: "We present a novel approach to testing.",
      categories: ["cs.AI", "cs.CL"],
      publishedAt: "2024-06-15T00:00:00Z",
      updatedAt: "2024-06-16T00:00:00Z",
    }),
    fetchArxivHtml: vi.fn().mockResolvedValue(
      `<html><body>
        <h1>Introduction</h1>
        <p>This paper introduces a new method for automated testing of software systems with comprehensive coverage.</p>
        <h2>Methods</h2>
        <p>We propose a transformer-based approach that achieves state-of-the-art results on multiple benchmarks in software testing.</p>
        <h2>Results</h2>
        <p>Our method outperforms existing baselines by a significant margin across all evaluation metrics we considered.</p>
        <section id="bib-references">
          <li>Some reference about arxiv paper 2312.10997v1 with DOI 10.1234/test</li>
        </section>
      </body></html>`,
    ),
    fetchArxivPdf: vi.fn().mockResolvedValue(null),
  };
});

const { ingestPaper, processQueueMessage } = await import("@ronbun/api");
const { fetchArxivMetadata, fetchArxivHtml } = await import("@ronbun/arxiv");

function createMockQueue() {
  const messages: QueueMessage[] = [];
  return {
    send: vi.fn(async (msg: QueueMessage) => {
      messages.push(msg);
    }),
    messages,
  };
}

function createMockAi() {
  return {
    run: vi.fn().mockImplementation(async (model: string, _input: any) => {
      if (model === "@cf/baai/bge-large-en-v1.5") {
        return { data: [Array(1024).fill(0.01)] };
      }
      // LLM extraction
      return {
        response: JSON.stringify({
          methods: [{ name: "TransformerTest", detail: "A transformer-based testing method" }],
          datasets: [{ name: "TestBench", detail: "Software testing benchmark" }],
          baselines: [],
          metrics: [{ name: "Accuracy", detail: "Classification accuracy" }],
          results: [],
          contributions: [],
          limitations: [],
        }),
      };
    }),
  } as unknown as Ai;
}

function createMockVectorIndex() {
  return {
    upsert: vi.fn().mockResolvedValue(null),
    query: vi.fn().mockResolvedValue({ matches: [] }),
  } as unknown as VectorizeIndex;
}

function createMockStorage() {
  const store = new Map<string, string | ArrayBuffer>();
  return {
    put: vi.fn(async (key: string, value: string | ArrayBuffer) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return {
        text: async () => (typeof v === "string" ? v : new TextDecoder().decode(v as ArrayBuffer)),
        arrayBuffer: async () => (typeof v === "string" ? new TextEncoder().encode(v).buffer : v),
      };
    }),
    _store: store,
  } as unknown as R2Bucket;
}

function createContext(overrides?: Partial<RonbunContext>): RonbunContext {
  return {
    db: env.DB,
    storage: createMockStorage(),
    ai: createMockAi(),
    vectorIndex: createMockVectorIndex(),
    queue: createMockQueue() as unknown as Queue<QueueMessage>,
    ...overrides,
  };
}

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("Paper Ingestion Pipeline", () => {
  describe("ingestPaper", () => {
    it("inserts new paper as queued and sends metadata queue message", async () => {
      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });

      const result = await ingestPaper(ctx, { arxivId: "2406.00001" });
      expect(result.status).toBe("queued");
      expect(result.paperId).toBeDefined();

      // Verify DB insert
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE arxiv_id = ?")
        .bind("2406.00001")
        .first();
      expect(paper).not.toBeNull();
      expect(paper!.status).toBe("queued");

      // Verify queue message
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      expect(mockQueue.messages[0].step).toBe("metadata");
      expect(mockQueue.messages[0].arxivId).toBe("2406.00001");
    });

    it("returns existing paper without re-ingesting (ready)", async () => {
      // Insert a ready paper
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'ready', ?)",
      )
        .bind("existing-ready", "2406.00002", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });

      const result = await ingestPaper(ctx, { arxivId: "2406.00002" });
      expect(result.status).toBe("ready");
      expect(result.paperId).toBe("existing-ready");
      expect(result.message).toBe("Paper already exists");
      expect(mockQueue.send).not.toHaveBeenCalled();
    });

    it("deletes failed paper and re-ingests", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, error, created_at) VALUES (?, ?, 'failed', 'old error', ?)",
      )
        .bind("existing-failed", "2406.00003", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });

      const result = await ingestPaper(ctx, { arxivId: "2406.00003" });
      expect(result.status).toBe("queued");
      expect(result.paperId).not.toBe("existing-failed"); // New ID
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("processMetadata (via processQueueMessage)", () => {
    it("fetches metadata, updates DB, creates author links, queues content step", async () => {
      // Create a queued paper
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("pm-1", "2406.10001", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });

      await processQueueMessage(ctx, {
        paperId: "pm-1",
        arxivId: "2406.10001",
        step: "metadata",
      });

      // Verify DB updated
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pm-1").first();
      expect(paper!.title).toBe("Test Paper: A Novel Approach");
      expect(paper!.status).toBe("metadata");
      expect(paper!.authors).toContain("Alice Smith");

      // Verify entity links for authors
      const links = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
      )
        .bind("pm-1")
        .all();
      expect(links.results.length).toBe(2);

      // Verify content step queued
      expect(mockQueue.messages[0].step).toBe("content");
    });

    it("marks paper as failed on metadata fetch error", async () => {
      vi.mocked(fetchArxivMetadata).mockRejectedValueOnce(new Error("API down"));

      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("pm-fail", "2406.10002", new Date().toISOString())
        .run();

      const ctx = createContext();

      await expect(
        processQueueMessage(ctx, {
          paperId: "pm-fail",
          arxivId: "2406.10002",
          step: "metadata",
        }),
      ).rejects.toThrow("API down");

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("pm-fail")
        .first();
      expect(paper!.status).toBe("failed");
      expect(paper!.error).toContain("API down");
    });
  });

  describe("processContent (via processQueueMessage)", () => {
    it("fetches HTML, stores in R2, inserts sections/citations, queues extraction", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
      )
        .bind("pc-1", "2406.20001", "Content Test Paper", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const mockStorage = createMockStorage();
      const ctx = createContext({
        queue: mockQueue as unknown as Queue<QueueMessage>,
        storage: mockStorage,
      });

      await processQueueMessage(ctx, {
        paperId: "pc-1",
        arxivId: "2406.20001",
        step: "content",
      });

      // Verify status updated to parsed
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pc-1").first();
      expect(paper!.status).toBe("parsed");

      // Verify sections inserted
      const sections = await env.DB.prepare(
        "SELECT * FROM sections WHERE paper_id = ? ORDER BY position",
      )
        .bind("pc-1")
        .all();
      expect(sections.results.length).toBeGreaterThan(0);

      // Verify R2 storage (via mock)
      expect(mockStorage.put).toHaveBeenCalled();

      // Verify extraction step queued
      expect(mockQueue.messages[0].step).toBe("extraction");
    });

    it("marks paper as failed when both HTML and PDF fail", async () => {
      vi.mocked(fetchArxivHtml).mockResolvedValueOnce(null);

      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'metadata', ?)",
      )
        .bind("pc-fail", "2406.20002", new Date().toISOString())
        .run();

      const ctx = createContext();

      await expect(
        processQueueMessage(ctx, {
          paperId: "pc-fail",
          arxivId: "2406.20002",
          step: "content",
        }),
      ).rejects.toThrow("Failed to fetch paper content");

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("pc-fail")
        .first();
      expect(paper!.status).toBe("failed");
    });
  });

  describe("processExtraction (via processQueueMessage)", () => {
    it("extracts knowledge from sections via AI, inserts extractions/entity_links", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'parsed', ?)",
      )
        .bind("pe-1", "2406.30001", "Extraction Test", new Date().toISOString())
        .run();

      await env.DB.prepare(
        "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("pe-sec-1", "pe-1", "Methods", 2, "We use a transformer-based approach.", 0)
        .run();

      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });

      await processQueueMessage(ctx, {
        paperId: "pe-1",
        arxivId: "2406.30001",
        step: "extraction",
      });

      // Verify status updated to extracted
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pe-1").first();
      expect(paper!.status).toBe("extracted");

      // Verify extractions inserted
      const extractions = await env.DB.prepare("SELECT * FROM extractions WHERE paper_id = ?")
        .bind("pe-1")
        .all();
      expect(extractions.results.length).toBeGreaterThan(0);

      // Verify entity_links for methods/datasets
      const links = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type IN ('method', 'dataset')",
      )
        .bind("pe-1")
        .all();
      expect(links.results.length).toBeGreaterThan(0);

      // Verify embedding step queued
      expect(mockQueue.messages[0].step).toBe("embedding");
    });
  });

  describe("processEmbedding (via processQueueMessage)", () => {
    it("generates embeddings and marks paper as ready", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'extracted', ?)",
      )
        .bind("pemb-1", "2406.40001", "Embedding Test", new Date().toISOString())
        .run();

      await env.DB.prepare(
        "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("pemb-sec-1", "pemb-1", "Introduction", 1, "Test section content for embedding.", 0)
        .run();

      const mockVectorIndex = createMockVectorIndex();
      const ctx = createContext({ vectorIndex: mockVectorIndex });

      await processQueueMessage(ctx, {
        paperId: "pemb-1",
        arxivId: "2406.40001",
        step: "embedding",
      });

      // Verify status = ready with ingested_at
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("pemb-1")
        .first();
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();

      // Verify vectorIndex.upsert called
      expect(mockVectorIndex.upsert).toHaveBeenCalled();
    });

    it("still marks paper as ready when individual embedding generation fails (graceful degradation)", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'extracted', ?)",
      )
        .bind("pemb-degrade", "2406.40002", "Embed Degrade Test", new Date().toISOString())
        .run();

      await env.DB.prepare(
        "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "pemb-degrade-sec",
          "pemb-degrade",
          "Intro",
          1,
          "Some content for the embedding test.",
          0,
        )
        .run();

      const failAi = {
        run: vi.fn().mockRejectedValue(new Error("embedding model error")),
      } as unknown as Ai;
      const mockVectorIndex = createMockVectorIndex();

      const ctx = createContext({ ai: failAi, vectorIndex: mockVectorIndex });

      // upsertSectionEmbeddings catches per-section errors, so processEmbedding
      // succeeds and marks the paper as ready with 0 embeddings
      await processQueueMessage(ctx, {
        paperId: "pemb-degrade",
        arxivId: "2406.40002",
        step: "embedding",
      });

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("pemb-degrade")
        .first();
      expect(paper!.status).toBe("ready");
      // upsert should not have been called since all embeddings failed
      expect(mockVectorIndex.upsert).not.toHaveBeenCalled();
    });
  });

  describe("Full pipeline (end-to-end)", () => {
    it("runs all steps from ingest to ready", async () => {
      const mockQueue = createMockQueue();
      const mockVectorIndex = createMockVectorIndex();
      const ctx = createContext({
        queue: mockQueue as unknown as Queue<QueueMessage>,
        vectorIndex: mockVectorIndex,
      });

      // Step 1: Ingest
      const result = await ingestPaper(ctx, { arxivId: "2406.99999" });
      expect(result.status).toBe("queued");
      const paperId = result.paperId;

      // Step 2: Process metadata
      await processQueueMessage(ctx, mockQueue.messages[0]);
      let paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("metadata");

      // Step 3: Process content
      await processQueueMessage(ctx, mockQueue.messages[1]);
      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("parsed");

      // Step 4: Process extraction
      await processQueueMessage(ctx, mockQueue.messages[2]);
      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("extracted");

      // Step 5: Process embedding
      await processQueueMessage(ctx, mockQueue.messages[3]);
      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();
      expect(paper!.title).toBe("Test Paper: A Novel Approach");

      // Verify sections exist
      const sections = await env.DB.prepare("SELECT * FROM sections WHERE paper_id = ?")
        .bind(paperId)
        .all();
      expect(sections.results.length).toBeGreaterThan(0);

      // Verify extractions exist
      const extractions = await env.DB.prepare("SELECT * FROM extractions WHERE paper_id = ?")
        .bind(paperId)
        .all();
      expect(extractions.results.length).toBeGreaterThan(0);

      // Verify vector upsert was called
      expect(mockVectorIndex.upsert).toHaveBeenCalled();
    });
  });
});
