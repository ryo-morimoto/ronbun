import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import { insertPaper } from "../src/papers.ts";
import {
  insertEntityLink,
  getRelatedPapers,
  findSharedEntities,
} from "../src/entity-links.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
  await insertPaper(env.DB, "elp-1", "2901.00001");
  await insertPaper(env.DB, "elp-2", "2901.00002");
  await insertPaper(env.DB, "elp-3", "2901.00003");
  await env.DB.prepare(`UPDATE papers SET title = 'Paper One' WHERE id = ?`).bind("elp-1").run();
  await env.DB.prepare(`UPDATE papers SET title = 'Paper Two' WHERE id = ?`).bind("elp-2").run();
  await env.DB.prepare(`UPDATE papers SET title = 'Paper Three' WHERE id = ?`).bind("elp-3").run();
});

describe("entity-links", () => {
  describe("insertEntityLink + getRelatedPapers", () => {
    it("finds related papers via shared entity", async () => {
      await insertEntityLink(env.DB, "el-a1", "elp-1", "method", "Transformer");
      await insertEntityLink(env.DB, "el-a2", "elp-2", "method", "Transformer");
      await insertEntityLink(env.DB, "el-a3", "elp-1", "dataset", "ImageNet");
      await insertEntityLink(env.DB, "el-a4", "elp-3", "dataset", "ImageNet");

      const related = await getRelatedPapers(env.DB, "elp-1");
      expect(related.length).toBe(2);
      const paperIds = related.map((r) => r.paper_id);
      expect(paperIds).toContain("elp-2");
      expect(paperIds).toContain("elp-3");
    });

    it("returns empty for paper with no shared entities", async () => {
      await insertPaper(env.DB, "elp-lone", "2901.00004");
      await insertEntityLink(env.DB, "el-lone", "elp-lone", "author", "Unique Author");
      const related = await getRelatedPapers(env.DB, "elp-lone");
      expect(related.length).toBe(0);
    });
  });

  describe("findSharedEntities", () => {
    it("finds shared entities filtered by type", async () => {
      await insertPaper(env.DB, "elp-s1", "2901.00011");
      await insertPaper(env.DB, "elp-s2", "2901.00012");
      await env.DB.prepare(`UPDATE papers SET title = 'Paper S1' WHERE id = ?`).bind("elp-s1").run();
      await env.DB.prepare(`UPDATE papers SET title = 'Paper S2' WHERE id = ?`).bind("elp-s2").run();
      await insertEntityLink(env.DB, "el-s1", "elp-s1", "method", "BERT");
      await insertEntityLink(env.DB, "el-s2", "elp-s2", "method", "BERT");

      const shared = await findSharedEntities(env.DB, "elp-s1", "method");
      expect(shared.length).toBe(1);
      expect(shared[0].paper_id).toBe("elp-s2");
      expect(shared[0].entity_name).toBe("BERT");
    });

    it("returns different results for different entity types", async () => {
      await insertPaper(env.DB, "elp-s3", "2901.00013");
      await insertPaper(env.DB, "elp-s4", "2901.00014");
      await env.DB.prepare(`UPDATE papers SET title = 'Paper S3' WHERE id = ?`).bind("elp-s3").run();
      await env.DB.prepare(`UPDATE papers SET title = 'Paper S4' WHERE id = ?`).bind("elp-s4").run();
      await insertEntityLink(env.DB, "el-s3", "elp-s3", "dataset", "COCO");
      await insertEntityLink(env.DB, "el-s4", "elp-s4", "dataset", "COCO");

      const datasets = await findSharedEntities(env.DB, "elp-s3", "dataset");
      expect(datasets.length).toBe(1);
      expect(datasets[0].paper_id).toBe("elp-s4");
    });

    it("returns empty for unmatched type", async () => {
      const shared = await findSharedEntities(env.DB, "elp-1", "author");
      expect(shared.length).toBe(0);
    });
  });
});
