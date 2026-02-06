import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration, seedTestData, clearTestData } from "./setup.ts";

describe("D1 database operations", () => {
  beforeAll(async () => {
    await applyMigration(env.DB);
    await clearTestData(env.DB);
    await seedTestData(env.DB);
  });

  describe("papers table", () => {
    it("queries paper by arxiv_id", async () => {
      const result = await env.DB.prepare("SELECT * FROM papers WHERE arxiv_id = ?")
        .bind("2401.15884")
        .first();
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Corrective Retrieval Augmented Generation");
      expect(result!.status).toBe("ready");
    });

    it("queries paper by id", async () => {
      const result = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-1")
        .first();
      expect(result).not.toBeNull();
      expect(result!.arxiv_id).toBe("2401.15884");
    });

    it("filters papers by status", async () => {
      const result = await env.DB.prepare("SELECT * FROM papers WHERE status = ?")
        .bind("ready")
        .all();
      expect(result.results.length).toBe(2);
    });

    it("returns null for non-existent paper", async () => {
      const result = await env.DB.prepare("SELECT * FROM papers WHERE arxiv_id = ?")
        .bind("9999.99999")
        .first();
      expect(result).toBeNull();
    });

    it("enforces unique arxiv_id", async () => {
      await expect(
        env.DB.prepare(
          "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
        )
          .bind("paper-dup", "2401.15884", "2024-01-01T00:00:00Z")
          .run(),
      ).rejects.toThrow();
    });

    it("enforces valid status", async () => {
      await expect(
        env.DB.prepare("INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, ?, ?)")
          .bind("paper-bad", "9999.00001", "invalid_status", "2024-01-01T00:00:00Z")
          .run(),
      ).rejects.toThrow();
    });

    it("orders by published_at", async () => {
      const result = await env.DB.prepare(
        "SELECT arxiv_id FROM papers WHERE status = 'ready' ORDER BY published_at DESC",
      ).all();
      expect(result.results[0].arxiv_id).toBe("2401.15884");
      expect(result.results[1].arxiv_id).toBe("2312.10997");
    });

    it("supports cursor-based pagination", async () => {
      const allPapers = await env.DB.prepare("SELECT * FROM papers ORDER BY created_at DESC").all();

      // Need at least 3 papers for pagination test
      if (allPapers.results.length < 3) {
        // Skip this test if not enough data
        return;
      }

      const page1 = await env.DB.prepare(
        "SELECT * FROM papers ORDER BY created_at DESC LIMIT 2",
      ).all();
      expect(page1.results.length).toBe(2);

      const lastId = page1.results[1].id as string;
      const lastCreatedAt = page1.results[1].created_at as string;
      const page2 = await env.DB.prepare(
        "SELECT * FROM papers WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC LIMIT 2",
      )
        .bind(lastCreatedAt, lastCreatedAt, lastId)
        .all();
      expect(page2.results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("sections table", () => {
    it("queries sections by paper_id in order", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM sections WHERE paper_id = ? ORDER BY position",
      )
        .bind("paper-1")
        .all();
      expect(result.results.length).toBe(2);
      expect(result.results[0].heading).toBe("Introduction");
      expect(result.results[0].position).toBe(0);
      expect(result.results[1].heading).toBe("Methods");
      expect(result.results[1].position).toBe(1);
    });
  });

  describe("extractions table", () => {
    it("queries extractions by type", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM extractions WHERE paper_id = ? AND type = ?",
      )
        .bind("paper-1", "method")
        .all();
      expect(result.results.length).toBe(1);
      expect(result.results[0].name).toBe("CRAG");
    });

    it("queries all extractions for a paper", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM extractions WHERE paper_id = ? ORDER BY type, name",
      )
        .bind("paper-1")
        .all();
      expect(result.results.length).toBe(2);
    });
  });

  describe("citations table", () => {
    it("queries outgoing citations", async () => {
      const result = await env.DB.prepare("SELECT * FROM citations WHERE source_paper_id = ?")
        .bind("paper-1")
        .all();
      expect(result.results.length).toBe(1);
      expect(result.results[0].target_arxiv_id).toBe("2312.10997");
    });

    it("queries incoming citations (cited-by)", async () => {
      const result = await env.DB.prepare(
        "SELECT c.*, p.title as source_title FROM citations c JOIN papers p ON p.id = c.source_paper_id WHERE c.target_paper_id = ?",
      )
        .bind("paper-2")
        .all();
      expect(result.results.length).toBe(1);
      expect(result.results[0].source_title).toBe("Corrective Retrieval Augmented Generation");
    });
  });

  describe("entity_links table", () => {
    it("finds shared entities between papers", async () => {
      const result = await env.DB.prepare(
        `SELECT DISTINCT el2.paper_id, p.title
       FROM entity_links el
       JOIN entity_links el2 ON el.entity_type = el2.entity_type
         AND el.entity_name = el2.entity_name
         AND el.paper_id != el2.paper_id
       JOIN papers p ON p.id = el2.paper_id
       WHERE el.paper_id = ?`,
      )
        .bind("paper-1")
        .all();
      expect(result.results.length).toBe(1);
      expect(result.results[0].paper_id).toBe("paper-2");
    });

    it("queries entity links by type", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = ?",
      )
        .bind("paper-1", "author")
        .all();
      expect(result.results.length).toBe(1);
      expect(result.results[0].entity_name).toBe("Shi-Qi Yan");
    });
  });

  describe("paper get query (composite)", () => {
    it("fetches full paper details with joins", async () => {
      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-1")
        .first();
      expect(paper).not.toBeNull();

      const sections = await env.DB.prepare(
        "SELECT * FROM sections WHERE paper_id = ? ORDER BY position",
      )
        .bind("paper-1")
        .all();
      expect(sections.results.length).toBe(2);

      const extractions = await env.DB.prepare("SELECT * FROM extractions WHERE paper_id = ?")
        .bind("paper-1")
        .all();
      expect(extractions.results.length).toBe(2);

      const citations = await env.DB.prepare("SELECT * FROM citations WHERE source_paper_id = ?")
        .bind("paper-1")
        .all();
      expect(citations.results.length).toBe(1);

      const related = await env.DB.prepare(
        `SELECT DISTINCT el2.paper_id, p.title, p.arxiv_id, el.entity_type, el.entity_name
       FROM entity_links el
       JOIN entity_links el2 ON el.entity_type = el2.entity_type
         AND el.entity_name = el2.entity_name
         AND el.paper_id != el2.paper_id
       JOIN papers p ON p.id = el2.paper_id
       WHERE el.paper_id = ?`,
      )
        .bind("paper-1")
        .all();
      expect(related.results.length).toBe(1);
    });
  });

  describe("insert and update operations", () => {
    it("inserts a new paper and updates status", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("paper-new", "2499.00001", "2024-06-01T00:00:00Z")
        .run();

      let paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-new")
        .first();
      expect(paper!.status).toBe("queued");

      await env.DB.prepare("UPDATE papers SET status = 'metadata', title = ? WHERE id = ?")
        .bind("New Paper Title", "paper-new")
        .run();

      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("paper-new").first();
      expect(paper!.status).toBe("metadata");
      expect(paper!.title).toBe("New Paper Title");
    });

    it("marks paper as failed with error", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("paper-fail", "2499.00002", "2024-07-01T00:00:00Z")
        .run();

      await env.DB.prepare("UPDATE papers SET status = 'failed', error = ? WHERE id = ?")
        .bind("Test error message", "paper-fail")
        .run();

      const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-fail")
        .first();
      expect(paper!.status).toBe("failed");
      expect(paper!.error).toBe("Test error message");
    });
  });
});
