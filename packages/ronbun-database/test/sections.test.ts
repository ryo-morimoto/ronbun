import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import { insertPaper } from "../src/papers.ts";
import { getSectionsByPaperId, insertSection, getSectionsForExtraction } from "../src/sections.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
  await insertPaper(env.DB, "sp-1", "2601.00001");
});

describe("sections", () => {
  describe("insertSection + getSectionsByPaperId", () => {
    it("inserts and retrieves sections in order", async () => {
      await insertSection(env.DB, "ss-1", "sp-1", "Introduction", 1, "Intro content", 0);
      await insertSection(env.DB, "ss-2", "sp-1", "Methods", 2, "Methods content here.", 1);
      await insertSection(env.DB, "ss-3", "sp-1", "Results", 2, "Results content here.", 2);

      const sections = await getSectionsByPaperId(env.DB, "sp-1");
      expect(sections.length).toBe(3);
      expect(sections[0].heading).toBe("Introduction");
      expect(sections[0].position).toBe(0);
      expect(sections[1].heading).toBe("Methods");
      expect(sections[2].heading).toBe("Results");
    });

    it("returns empty for paper with no sections", async () => {
      await insertPaper(env.DB, "sp-empty", "2601.00002");
      const sections = await getSectionsByPaperId(env.DB, "sp-empty");
      expect(sections.length).toBe(0);
    });
  });

  describe("getSectionsForExtraction", () => {
    it("returns limited sections with id, heading, content", async () => {
      await insertPaper(env.DB, "sp-extract", "2601.00003");
      await insertSection(env.DB, "ss-e1", "sp-extract", "Intro", 1, "Content 1", 0);
      await insertSection(env.DB, "ss-e2", "sp-extract", "Methods", 2, "Content 2", 1);
      await insertSection(env.DB, "ss-e3", "sp-extract", "Results", 2, "Content 3", 2);

      const sections = await getSectionsForExtraction(env.DB, "sp-extract", 2);
      expect(sections.length).toBe(2);
      expect(sections[0]).toHaveProperty("id");
      expect(sections[0]).toHaveProperty("heading");
      expect(sections[0]).toHaveProperty("content");
    });

    it("returns all sections when limit is high", async () => {
      await insertPaper(env.DB, "sp-extract2", "2601.00004");
      await insertSection(env.DB, "ss-e4", "sp-extract2", "A", 1, "C1", 0);
      await insertSection(env.DB, "ss-e5", "sp-extract2", "B", 2, "C2", 1);
      await insertSection(env.DB, "ss-e6", "sp-extract2", "C", 2, "C3", 2);

      const sections = await getSectionsForExtraction(env.DB, "sp-extract2", 100);
      expect(sections.length).toBe(3);
    });
  });
});
