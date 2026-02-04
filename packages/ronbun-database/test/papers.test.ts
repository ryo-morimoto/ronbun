import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import {
  findPaperByArxivId,
  insertPaper,
  updatePaperMetadata,
  updatePaperStatus,
  markPaperReady,
  markPaperFailed,
  getPaperById,
  getPaperArxivId,
  listPapers,
  searchPapersFts,
  searchSectionsFts,
  fetchPapersByIds,
} from "../src/papers.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("papers", () => {
  describe("insertPaper + findPaperByArxivId", () => {
    it("inserts a paper and finds it by arxiv_id", async () => {
      await insertPaper(env.DB, "p-1", "2401.00001");
      const found = await findPaperByArxivId(env.DB, "2401.00001");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("p-1");
      expect(found!.arxiv_id).toBe("2401.00001");
      expect(found!.status).toBe("queued");
    });

    it("returns null for non-existent arxiv_id", async () => {
      const found = await findPaperByArxivId(env.DB, "9999.99999");
      expect(found).toBeNull();
    });
  });

  describe("updatePaperMetadata", () => {
    it("updates metadata and sets status to metadata", async () => {
      await insertPaper(env.DB, "p-meta", "2401.00002");
      await updatePaperMetadata(env.DB, "p-meta", {
        title: "Test Paper",
        authors: ["Author A", "Author B"],
        abstract: "An abstract.",
        categories: ["cs.AI", "cs.CL"],
        publishedAt: "2024-01-15T00:00:00Z",
        updatedAt: "2024-01-16T00:00:00Z",
      });
      const paper = await getPaperById(env.DB, "p-meta");
      expect(paper).not.toBeNull();
      expect(paper!.title).toBe("Test Paper");
      expect(paper!.authors).toBe('["Author A","Author B"]');
      expect(paper!.abstract).toBe("An abstract.");
      expect(paper!.categories).toBe('["cs.AI","cs.CL"]');
      expect(paper!.status).toBe("metadata");
    });
  });

  describe("updatePaperStatus", () => {
    it("updates status field", async () => {
      await insertPaper(env.DB, "p-status", "2401.00003");
      await updatePaperStatus(env.DB, "p-status", "parsed");
      const paper = await getPaperById(env.DB, "p-status");
      expect(paper!.status).toBe("parsed");
    });
  });

  describe("markPaperReady", () => {
    it("sets status to ready and sets ingested_at", async () => {
      await insertPaper(env.DB, "p-ready", "2401.00004");
      await markPaperReady(env.DB, "p-ready");
      const paper = await getPaperById(env.DB, "p-ready");
      expect(paper!.status).toBe("ready");
      expect(paper!.ingested_at).not.toBeNull();
    });
  });

  describe("markPaperFailed", () => {
    it("sets status to failed and records error", async () => {
      await insertPaper(env.DB, "p-fail", "2401.00005");
      await markPaperFailed(env.DB, "p-fail", new Error("fetch error"));
      const paper = await getPaperById(env.DB, "p-fail");
      expect(paper!.status).toBe("failed");
      expect(paper!.error).toContain("fetch error");
    });
  });

  describe("getPaperById", () => {
    it("finds by id", async () => {
      await insertPaper(env.DB, "p-byid", "2401.00006");
      const paper = await getPaperById(env.DB, "p-byid");
      expect(paper).not.toBeNull();
      expect(paper!.id).toBe("p-byid");
    });

    it("finds by arxiv_id", async () => {
      await insertPaper(env.DB, "p-byid2", "2401.00006v2");
      const paper = await getPaperById(env.DB, "2401.00006v2");
      expect(paper).not.toBeNull();
      expect(paper!.arxiv_id).toBe("2401.00006v2");
    });

    it("returns null for non-existent", async () => {
      const paper = await getPaperById(env.DB, "does-not-exist");
      expect(paper).toBeNull();
    });
  });

  describe("getPaperArxivId", () => {
    it("returns arxiv_id for existing paper", async () => {
      await insertPaper(env.DB, "p-arxiv", "2401.00007");
      const arxivId = await getPaperArxivId(env.DB, "p-arxiv");
      expect(arxivId).toBe("2401.00007");
    });

    it("returns null for non-existent paper", async () => {
      const arxivId = await getPaperArxivId(env.DB, "no-such-id");
      expect(arxivId).toBeNull();
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
      const results = await fetchPapersByIds(env.DB, ["p-1"]); // p-1 is queued
      expect(results.length).toBe(0);
    });
  });
});
