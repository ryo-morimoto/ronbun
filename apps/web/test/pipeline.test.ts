import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { applyMigration } from "./setup.ts";
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

const { processContent } = await import("@ronbun/api");
const { fetchArxivHtml, fetchArxivNativeHtml } = await import("@ronbun/arxiv");

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
    queue: null as unknown as Queue,
    ...overrides,
  };
}

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("Paper Content Processing Pipeline", () => {
  describe("processContent", () => {
    it("fetches HTML, stores in R2, inserts sections/citations, marks paper ready", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
      )
        .bind("pc-1", "2406.20001", "Content Test Paper", new Date().toISOString())
        .run();

      const mockStorage = createMockStorage();
      const ctx = createContext({ storage: mockStorage });

      await processContent(ctx, {
        paperId: "pc-1",
        arxivId: "2406.20001",
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
        processContent(ctx, {
          paperId: "pc-fail",
          arxivId: "2406.20002",
        }),
      ).rejects.toThrow("Failed to fetch paper content");

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("pc-fail")
        .first();
      expect(paper!.status).toBe("metadata");
    });
  });

  describe("Idempotency (retry safety)", () => {
    it("processContent twice does not duplicate sections", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
      )
        .bind("idem-content", "2406.idem02", "Test", new Date().toISOString())
        .run();

      const ctx = createContext();

      await processContent(ctx, {
        paperId: "idem-content",
        arxivId: "2406.idem02",
      });
      const countAfterFirst = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
      )
        .bind("idem-content")
        .first<{ cnt: number }>();

      await processContent(ctx, {
        paperId: "idem-content",
        arxivId: "2406.idem02",
      });
      const countAfterSecond = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
      )
        .bind("idem-content")
        .first<{ cnt: number }>();

      expect(countAfterSecond!.cnt).toBe(countAfterFirst!.cnt);
    });
  });

  describe("Full pipeline (end-to-end)", () => {
    it("processes content for a paper inserted with metadata status", async () => {
      const paperId = "e2e-paper-1";
      const mockVectorIndex = createMockVectorIndex();
      const ctx = createContext({ vectorIndex: mockVectorIndex });

      // Insert paper with 'metadata' status (as cron would do)
      await env.DB.prepare(
        `INSERT INTO papers (id, arxiv_id, title, authors, abstract, categories, published_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'metadata', ?)`,
      )
        .bind(
          paperId,
          "2406.99999",
          "Test Paper: A Novel Approach",
          '["Alice Smith","Bob Jones"]',
          "We present a novel approach to testing.",
          '["cs.AI","cs.CL"]',
          "2024-06-15T00:00:00Z",
          new Date().toISOString(),
        )
        .run();

      // Process content step
      await processContent(ctx, { paperId, arxivId: "2406.99999" });

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind(paperId).first();
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
