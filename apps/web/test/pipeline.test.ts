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
    fetchArxivNativeHtml: vi.fn().mockResolvedValue(null),
    fetchArxivPdf: vi.fn().mockResolvedValue(null),
    extractPdfText: vi.fn().mockResolvedValue(""),
  };
});

const { ingestPaper, processQueueMessage } = await import("@ronbun/api");
const { fetchArxivMetadata, fetchArxivHtml, fetchArxivNativeHtml } = await import("@ronbun/arxiv");

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
    run: vi.fn().mockImplementation(async () => {
      return { data: [Array(1024).fill(0.01)] };
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

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE arxiv_id = ?")
        .bind("2406.00001")
        .first();
      expect(paper).not.toBeNull();
      expect(paper!.status).toBe("queued");

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      expect(mockQueue.messages[0].step).toBe("metadata");
      expect(mockQueue.messages[0].arxivId).toBe("2406.00001");
    });

    it("returns existing paper without re-ingesting (ready)", async () => {
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
      expect(result.paperId).not.toBe("existing-failed");
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("processMetadata (via processQueueMessage)", () => {
    it("fetches metadata, updates DB, creates author links, embeds abstract, queues content step", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("pm-1", "2406.10001", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const mockVectorIndex = createMockVectorIndex();
      const ctx = createContext({
        queue: mockQueue as unknown as Queue<QueueMessage>,
        vectorIndex: mockVectorIndex,
      });

      await processQueueMessage(ctx, {
        paperId: "pm-1",
        arxivId: "2406.10001",
        step: "metadata",
      });

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pm-1").first();
      expect(paper!.title).toBe("Test Paper: A Novel Approach");
      expect(paper!.status).toBe("metadata");

      const links = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
      )
        .bind("pm-1")
        .all();
      expect(links.results.length).toBe(2);

      // Abstract embedding upserted
      expect(mockVectorIndex.upsert).toHaveBeenCalled();

      expect(mockQueue.messages[0].step).toBe("content");
    });

    it("throws on metadata fetch error without marking failed", async () => {
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
      expect(paper!.status).toBe("queued");
    });
  });

  describe("processContent (via processQueueMessage)", () => {
    it("fetches HTML, stores in R2, inserts sections/citations, marks paper ready", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
      )
        .bind("pc-1", "2406.20001", "Content Test Paper", new Date().toISOString())
        .run();

      const mockStorage = createMockStorage();
      const ctx = createContext({ storage: mockStorage });

      await processQueueMessage(ctx, {
        paperId: "pc-1",
        arxivId: "2406.20001",
        step: "content",
      });

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pc-1").first();
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();

      const sections = await env.DB.prepare(
        "SELECT * FROM sections WHERE paper_id = ? ORDER BY position",
      )
        .bind("pc-1")
        .all();
      expect(sections.results.length).toBeGreaterThan(0);

      expect(mockStorage.put).toHaveBeenCalled();
    });

    it("throws when both HTML and PDF fail without marking failed", async () => {
      vi.mocked(fetchArxivHtml).mockResolvedValueOnce(null);
      vi.mocked(fetchArxivNativeHtml).mockResolvedValueOnce(null);

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
      expect(paper!.status).toBe("metadata");
    });
  });

  describe("Idempotency (retry safety)", () => {
    it("processMetadata twice does not duplicate author entity_links", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("idem-meta", "2406.idem01", new Date().toISOString())
        .run();

      const mockQueue = createMockQueue();
      const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });
      const msg: QueueMessage = { paperId: "idem-meta", arxivId: "2406.idem01", step: "metadata" };

      await processQueueMessage(ctx, msg);
      await processQueueMessage(ctx, msg);

      const links = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
      )
        .bind("idem-meta")
        .all();
      expect(links.results.length).toBe(2);
    });

    it("processContent twice does not duplicate sections", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
      )
        .bind("idem-content", "2406.idem02", "Test", new Date().toISOString())
        .run();

      const ctx = createContext();
      const msg: QueueMessage = {
        paperId: "idem-content",
        arxivId: "2406.idem02",
        step: "content",
      };

      await processQueueMessage(ctx, msg);
      const countAfterFirst = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
      )
        .bind("idem-content")
        .first<{ cnt: number }>();

      await processQueueMessage(ctx, msg);
      const countAfterSecond = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
      )
        .bind("idem-content")
        .first<{ cnt: number }>();

      expect(countAfterSecond!.cnt).toBe(countAfterFirst!.cnt);
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

      // Step 2: Process metadata (+ abstract embedding)
      await processQueueMessage(ctx, mockQueue.messages[0]);
      let paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("metadata");
      expect(mockVectorIndex.upsert).toHaveBeenCalled();

      // Step 3: Process content → ready
      await processQueueMessage(ctx, mockQueue.messages[1]);
      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();
      expect(paper!.title).toBe("Test Paper: A Novel Approach");

      const sections = await env.DB.prepare("SELECT * FROM sections WHERE paper_id = ?")
        .bind(paperId)
        .all();
      expect(sections.results.length).toBeGreaterThan(0);
    });
  });
});
