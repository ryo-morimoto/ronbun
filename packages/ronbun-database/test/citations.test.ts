import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import { insertPaper } from "../src/papers.ts";
import {
  getCitationsBySource,
  getCitedBy,
  insertCitation,
  findPaperIdByArxivId,
} from "../src/citations.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
  await insertPaper(env.DB, "cp-1", "2801.00001");
  await insertPaper(env.DB, "cp-2", "2801.00002");
  await env.DB.prepare(`UPDATE papers SET title = 'Source Paper' WHERE id = ?`).bind("cp-1").run();
  await env.DB.prepare(`UPDATE papers SET title = 'Target Paper' WHERE id = ?`).bind("cp-2").run();
});

describe("citations", () => {
  describe("insertCitation + getCitationsBySource", () => {
    it("inserts and retrieves outgoing citations", async () => {
      await insertCitation(env.DB, "cit-a", "cp-1", "cp-2", "2801.00002", "Target Paper");

      const citations = await getCitationsBySource(env.DB, "cp-1");
      expect(citations.length).toBe(1);
      expect(citations[0].target_paper_id).toBe("cp-2");
      expect(citations[0].target_arxiv_id).toBe("2801.00002");
    });

    it("returns empty for paper with no outgoing citations", async () => {
      const citations = await getCitationsBySource(env.DB, "cp-2");
      expect(citations.length).toBe(0);
    });
  });

  describe("getCitedBy", () => {
    it("finds incoming citations", async () => {
      await insertPaper(env.DB, "cp-cited-1", "2801.00011");
      await insertPaper(env.DB, "cp-cited-2", "2801.00012");
      await env.DB.prepare(`UPDATE papers SET title = 'Citing Paper' WHERE id = ?`)
        .bind("cp-cited-1")
        .run();
      await env.DB.prepare(`UPDATE papers SET title = 'Cited Paper' WHERE id = ?`)
        .bind("cp-cited-2")
        .run();
      await insertCitation(
        env.DB,
        "cit-test",
        "cp-cited-1",
        "cp-cited-2",
        "2801.00012",
        "Cited Paper",
      );

      const citedBy = await getCitedBy(env.DB, "cp-cited-2");
      expect(citedBy.length).toBe(1);
      expect(citedBy[0].source_paper_id).toBe("cp-cited-1");
      expect(citedBy[0].source_title).toBe("Citing Paper");
    });

    it("returns empty for paper not cited by anyone", async () => {
      const citedBy = await getCitedBy(env.DB, "cp-1");
      expect(citedBy.length).toBe(0);
    });
  });

  describe("findPaperIdByArxivId", () => {
    it("finds paper id by arxiv id", async () => {
      const id = await findPaperIdByArxivId(env.DB, "2801.00001");
      expect(id).toBe("cp-1");
    });

    it("returns null for non-existent arxiv id", async () => {
      const id = await findPaperIdByArxivId(env.DB, "9999.99999");
      expect(id).toBeNull();
    });
  });
});
