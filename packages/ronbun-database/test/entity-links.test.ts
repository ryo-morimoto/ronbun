import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import { insertPapersWithMetadataBatch } from "../src/papers.ts";
import { insertEntityLink, getRelatedPapers, findSharedEntities } from "../src/entity-links.ts";

async function insertTestPaper(id: string, arxivId: string, title: string) {
  await insertPapersWithMetadataBatch(env.DB, [
    {
      id,
      arxivId,
      title,
      authors: [],
      abstract: "",
      categories: [],
      publishedAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ]);
  // Update title since insertPapersWithMetadataBatch sets it from the input
}

beforeAll(async () => {
  await applyMigration(env.DB);
  await insertTestPaper("elp-1", "2901.00001", "Paper One");
  await insertTestPaper("elp-2", "2901.00002", "Paper Two");
  await insertTestPaper("elp-3", "2901.00003", "Paper Three");
});

describe("entity-links", () => {
  describe("insertEntityLink + getRelatedPapers", () => {
    it("finds related papers via shared author", async () => {
      await insertEntityLink(env.DB, "el-a1", "elp-1", "author", "Alice Smith");
      await insertEntityLink(env.DB, "el-a2", "elp-2", "author", "Alice Smith");
      await insertEntityLink(env.DB, "el-a3", "elp-1", "author", "Bob Jones");
      await insertEntityLink(env.DB, "el-a4", "elp-3", "author", "Bob Jones");

      const related = await getRelatedPapers(env.DB, "elp-1");
      expect(related.length).toBe(2);
      const paperIds = related.map((r) => r.paper_id);
      expect(paperIds).toContain("elp-2");
      expect(paperIds).toContain("elp-3");
    });

    it("returns empty for paper with no shared entities", async () => {
      await insertTestPaper("elp-lone", "2901.00004", "Lonely Paper");
      await insertEntityLink(env.DB, "el-lone", "elp-lone", "author", "Unique Author");
      const related = await getRelatedPapers(env.DB, "elp-lone");
      expect(related.length).toBe(0);
    });
  });

  describe("findSharedEntities", () => {
    it("finds shared entities filtered by author type", async () => {
      await insertTestPaper("elp-s1", "2901.00011", "Paper S1");
      await insertTestPaper("elp-s2", "2901.00012", "Paper S2");
      await insertEntityLink(env.DB, "el-s1", "elp-s1", "author", "Shared Author");
      await insertEntityLink(env.DB, "el-s2", "elp-s2", "author", "Shared Author");

      const shared = await findSharedEntities(env.DB, "elp-s1", "author");
      expect(shared.length).toBe(1);
      expect(shared[0].paper_id).toBe("elp-s2");
      expect(shared[0].entity_name).toBe("Shared Author");
    });

    it("returns empty for unmatched entity name", async () => {
      await insertTestPaper("elp-s5", "2901.00015", "Paper S5");
      await insertEntityLink(env.DB, "el-s5", "elp-s5", "author", "Only Author");

      const shared = await findSharedEntities(env.DB, "elp-s5", "author");
      expect(shared.length).toBe(0);
    });
  });
});
