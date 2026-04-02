import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import {
  findPaperByArxivId,
  findExistingArxivIds,
  insertPapersWithMetadataBatch,
  markPaperReady,
  markPaperFailed,
  getPaperById,
  listPapers,
  searchPapersFts,
  searchSectionsFts,
  fetchPapersByIds,
} from "../src/papers.ts";
import type { PaperInsert } from "../src/papers.ts";

function makePaperInsert(
  overrides: Partial<PaperInsert> & { id: string; arxivId: string },
): PaperInsert {
  return {
    title: "Test Paper",
    authors: ["Author A"],
    abstract: "Test abstract.",
    categories: ["cs.AI"],
    publishedAt: "2024-01-15T00:00:00Z",
    updatedAt: "2024-01-16T00:00:00Z",
    ...overrides,
  };
}

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("papers", () => {
  describe("insertPapersWithMetadataBatch + findPaperByArxivId", () => {
    it("inserts papers with metadata status and finds them by arxiv_id", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-1", arxivId: "2401.00001" }),
      ]);

      const found = await findPaperByArxivId(env.DB, "2401.00001");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("p-1");
      expect(found!.arxiv_id).toBe("2401.00001");
      expect(found!.status).toBe("metadata");
    });

    it("returns null for non-existent arxiv_id", async () => {
      const found = await findPaperByArxivId(env.DB, "9999.99999");
      expect(found).toBeNull();
    });

    it("inserts author entity_links for each author", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({
          id: "p-authors",
          arxivId: "2401.00099",
          authors: ["Author A", "Author B"],
        }),
      ]);

      const links = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author' ORDER BY entity_name",
      )
        .bind("p-authors")
        .all();
      expect(links.results.length).toBe(2);
      const names = links.results.map((r) => r.entity_name);
      expect(names).toContain("Author A");
      expect(names).toContain("Author B");
    });

    it("inserts multiple papers in a single batch", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-batch-1", arxivId: "2402.00001" }),
        makePaperInsert({ id: "p-batch-2", arxivId: "2402.00002" }),
        makePaperInsert({ id: "p-batch-3", arxivId: "2402.00003" }),
      ]);

      const result = await env.DB.prepare(
        "SELECT id FROM papers WHERE id IN ('p-batch-1', 'p-batch-2', 'p-batch-3')",
      ).all();
      expect(result.results.length).toBe(3);
    });
  });

  describe("findExistingArxivIds", () => {
    it("returns a set of existing arxiv_ids", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-exist-1", arxivId: "2403.00001" }),
      ]);

      const existing = await findExistingArxivIds(env.DB, ["2403.00001", "9999.00000"]);
      expect(existing.has("2403.00001")).toBe(true);
      expect(existing.has("9999.00000")).toBe(false);
    });

    it("returns empty set for empty input", async () => {
      const existing = await findExistingArxivIds(env.DB, []);
      expect(existing.size).toBe(0);
    });
  });

  describe("markPaperReady", () => {
    it("sets status to ready and sets ingested_at", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-ready", arxivId: "2401.00004" }),
      ]);
      await markPaperReady(env.DB, "p-ready");
      const paper = await getPaperById(env.DB, "p-ready");
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();
    });
  });

  describe("markPaperFailed", () => {
    it("sets status to failed and records error", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-fail", arxivId: "2401.00005" }),
      ]);
      await markPaperFailed(env.DB, "p-fail", new Error("fetch error"));
      const paper = await getPaperById(env.DB, "p-fail");
      expect(paper!.status).toBe("failed");
      expect(paper!.error).toContain("fetch error");
    });
  });

  describe("getPaperById", () => {
    it("finds by id", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-byid", arxivId: "2401.00006" }),
      ]);
      const paper = await getPaperById(env.DB, "p-byid");
      expect(paper).not.toBeNull();
      expect(paper!.id).toBe("p-byid");
    });

    it("finds by arxiv_id", async () => {
      await insertPapersWithMetadataBatch(env.DB, [
        makePaperInsert({ id: "p-byid2", arxivId: "2401.00006v2" }),
      ]);
      const paper = await getPaperById(env.DB, "2401.00006v2");
      expect(paper).not.toBeNull();
      expect(paper!.arxiv_id).toBe("2401.00006v2");
    });

    it("returns null for non-existent", async () => {
      const paper = await getPaperById(env.DB, "does-not-exist");
      expect(paper).toBeNull();
    });
  });

  describe("listPapers", () => {
    beforeAll(async () => {
      // Seed some ready papers for listing
      for (const [id, arxiv, title, cat, year] of [
        ["p-list-1", "2301.00001", "Paper A", "cs.AI", "2023"],
        ["p-list-2", "2301.00002", "Paper B", "cs.CL", "2023"],
        ["p-list-3", "2401.00010", "Paper C", "cs.AI", "2024"],
      ] as const) {
        await env.DB.prepare(
          `INSERT INTO papers (id, arxiv_id, title, categories, published_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
        )
          .bind(
            id,
            arxiv,
            title,
            `["${cat}"]`,
            `${year}-06-01T00:00:00Z`,
            `${year}-06-01T00:00:00Z`,
          )
          .run();
      }
    });

    it("lists papers with default sort", async () => {
      const result = await listPapers(env.DB, {
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 50,
      });
      expect(result.papers.length).toBeGreaterThan(0);
      expect(result.hasMore).toBe(false);
    });

    it("filters by status", async () => {
      const result = await listPapers(env.DB, {
        status: "ready",
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 50,
      });
      for (const p of result.papers) {
        expect(p.status).toBe("ready");
      }
    });

    it("filters by category", async () => {
      const result = await listPapers(env.DB, {
        category: "cs.AI",
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 50,
      });
      for (const p of result.papers) {
        expect(p.categories).toContain("cs.AI");
      }
    });

    it("filters by year", async () => {
      const result = await listPapers(env.DB, {
        year: 2024,
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 50,
      });
      for (const p of result.papers) {
        expect(p.published_at).toContain("2024");
      }
    });

    it("respects limit and returns hasMore", async () => {
      const result = await listPapers(env.DB, {
        status: "ready",
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 1,
      });
      expect(result.papers.length).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it("supports cursor pagination", async () => {
      const page1 = await listPapers(env.DB, {
        status: "ready",
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 1,
      });
      expect(page1.papers.length).toBe(1);
      const cursor = page1.papers[0].id;

      const page2 = await listPapers(env.DB, {
        status: "ready",
        sortBy: "created_at",
        sortOrder: "desc",
        cursor,
        limit: 1,
      });
      expect(page2.papers.length).toBe(1);
      expect(page2.papers[0].id).not.toBe(cursor);
    });
  });

  describe("searchPapersFts", () => {
    beforeAll(async () => {
      await env.DB.prepare(
        `INSERT INTO papers (id, arxiv_id, title, abstract, status, created_at)
         VALUES (?, ?, ?, ?, 'ready', ?)`,
      )
        .bind(
          "p-fts-1",
          "2501.00001",
          "Deep Learning Survey",
          "A comprehensive survey of deep learning methods.",
          "2025-01-01T00:00:00Z",
        )
        .run();
    });

    it("finds papers matching FTS query", async () => {
      const results = await searchPapersFts(env.DB, "deep learning", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain("Deep Learning");
    });

    it("returns empty for no match", async () => {
      const results = await searchPapersFts(env.DB, "zzzzzzzznotexist", 10);
      expect(results.length).toBe(0);
    });
  });

  describe("searchSectionsFts", () => {
    beforeAll(async () => {
      await env.DB.prepare(
        `INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'ready', ?)`,
      )
        .bind("p-secfts", "2501.00002", "Section FTS Paper", "2025-01-01T00:00:00Z")
        .run();

      await env.DB.prepare(
        `INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "sec-fts-1",
          "p-secfts",
          "Transformers",
          1,
          "Attention is all you need. Transformers architecture.",
          0,
        )
        .run();
    });

    it("finds papers via section content match", async () => {
      const results = await searchSectionsFts(env.DB, "transformers", 10);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("updatePaperError", () => {
    it("updates error column without changing status", async () => {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'metadata', ?)",
      )
        .bind("upe-1", "2406.upe01", new Date().toISOString())
        .run();

      const { updatePaperError } = await import("../src/papers.ts");
      await updatePaperError(
        env.DB,
        "upe-1",
        JSON.stringify({
          step: "content",
          message: "fetch failed",
          name: "Error",
          attempt: 1,
        }),
      );

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("upe-1").first();
      expect(paper!.status).toBe("metadata"); // unchanged
      expect(paper!.error).toContain("fetch failed");
      expect(JSON.parse(paper!.error as string).step).toBe("content");
    });
  });

  describe("fetchPapersByIds", () => {
    it("fetches multiple papers by ids (only ready)", async () => {
      await env.DB.prepare(
        `INSERT INTO papers (id, arxiv_id, title, status, created_at)
         VALUES (?, ?, ?, 'ready', ?)`,
      )
        .bind("p-fetch-1", "2501.00011", "Fetch Test 1", "2025-01-01T00:00:00Z")
        .run();
      await env.DB.prepare(
        `INSERT INTO papers (id, arxiv_id, title, status, created_at)
         VALUES (?, ?, ?, 'ready', ?)`,
      )
        .bind("p-fetch-2", "2501.00012", "Fetch Test 2", "2025-01-01T00:00:00Z")
        .run();

      const results = await fetchPapersByIds(env.DB, ["p-fetch-1", "p-fetch-2"]);
      expect(results.length).toBe(2);
    });

    it("returns empty for empty array", async () => {
      const results = await fetchPapersByIds(env.DB, []);
      expect(results.length).toBe(0);
    });

    it("excludes non-ready papers", async () => {
      const results = await fetchPapersByIds(env.DB, ["p-1"]); // p-1 is metadata
      expect(results.length).toBe(0);
    });
  });
});
