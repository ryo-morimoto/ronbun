import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import { insertPaper } from "../src/papers.ts";
import { insertSection } from "../src/sections.ts";
import {
  getExtractionsByPaperId,
  insertExtraction,
  searchExtractionsFts,
} from "../src/extractions.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
  await insertPaper(env.DB, "ep-1", "2701.00001");
  await env.DB.prepare(
    `UPDATE papers SET title = 'Extraction Test Paper', status = 'ready' WHERE id = ?`,
  )
    .bind("ep-1")
    .run();
  await insertSection(env.DB, "es-1", "ep-1", "Methods", 2, "Method details", 0);
});

describe("extractions", () => {
  describe("insertExtraction + getExtractionsByPaperId", () => {
    it("inserts and retrieves extractions", async () => {
      await insertExtraction(
        env.DB,
        "ext-a",
        "ep-1",
        "method",
        "Transformer",
        "A neural architecture",
        "es-1",
      );
      await insertExtraction(
        env.DB,
        "ext-b",
        "ep-1",
        "dataset",
        "ImageNet",
        "Large image dataset",
        null,
      );

      const extractions = await getExtractionsByPaperId(env.DB, "ep-1");
      expect(extractions.length).toBe(2);
      // Ordered by type, name
      expect(extractions[0].type).toBe("dataset");
      expect(extractions[0].name).toBe("ImageNet");
      expect(extractions[1].type).toBe("method");
      expect(extractions[1].name).toBe("Transformer");
    });

    it("returns empty for paper with no extractions", async () => {
      await insertPaper(env.DB, "ep-empty", "2701.00002");
      const extractions = await getExtractionsByPaperId(env.DB, "ep-empty");
      expect(extractions.length).toBe(0);
    });
  });

  describe("searchExtractionsFts", () => {
    it("finds extractions by name via FTS", async () => {
      await insertPaper(env.DB, "ep-fts", "2701.00003");
      await env.DB.prepare(
        `UPDATE papers SET title = 'FTS Test Paper', status = 'ready' WHERE id = ?`,
      )
        .bind("ep-fts")
        .run();
      await insertExtraction(
        env.DB,
        "ext-fts1",
        "ep-fts",
        "method",
        "Transformer",
        "A neural architecture",
        null,
      );

      const results = await searchExtractionsFts(env.DB, "Transformer", null, 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Transformer");
      expect(results[0].paper_title).toBe("FTS Test Paper");
    });

    it("filters by type", async () => {
      await insertPaper(env.DB, "ep-fts2", "2701.00004");
      await env.DB.prepare(
        `UPDATE papers SET title = 'FTS Test Paper 2', status = 'ready' WHERE id = ?`,
      )
        .bind("ep-fts2")
        .run();
      await insertExtraction(
        env.DB,
        "ext-fts2",
        "ep-fts2",
        "dataset",
        "ImageNet",
        "Large dataset",
        null,
      );

      const results = await searchExtractionsFts(env.DB, "ImageNet", "dataset", 10);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.type).toBe("dataset");
      }
    });

    it("returns empty for no match", async () => {
      const results = await searchExtractionsFts(env.DB, "zzzzzznotexist", null, 10);
      expect(results.length).toBe(0);
    });
  });
});
