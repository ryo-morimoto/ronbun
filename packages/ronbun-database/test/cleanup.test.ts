import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import {
  deleteAuthorLinksByPaperId,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
} from "../src/cleanup.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("cleanup functions", () => {
  const paperId = "cleanup-test-paper";

  beforeAll(async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'metadata', ?)",
    )
      .bind(paperId, "2406.cleanup", new Date().toISOString())
      .run();

    await env.DB.prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, 1, ?, 0)",
    )
      .bind("cs-1", paperId, "Intro", "Content")
      .run();
    await env.DB.prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, 1, ?, 1)",
    )
      .bind("cs-2", paperId, "Methods", "Content")
      .run();

    await env.DB.prepare(
      "INSERT INTO citations (id, source_paper_id, target_arxiv_id, target_title) VALUES (?, ?, ?, ?)",
    )
      .bind("cc-1", paperId, "2312.00001", "Some paper")
      .run();

    await env.DB.prepare(
      "INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'author', ?)",
    )
      .bind("cel-1", paperId, "Alice")
      .run();
  });

  it("deleteAuthorLinksByPaperId removes only author links", async () => {
    await deleteAuthorLinksByPaperId(env.DB, paperId);
    const authors = await env.DB.prepare(
      "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
    )
      .bind(paperId)
      .all();
    expect(authors.results.length).toBe(0);
  });

  it("deleteSectionsByPaperId removes all sections for paper", async () => {
    await deleteSectionsByPaperId(env.DB, paperId);
    const sections = await env.DB.prepare("SELECT * FROM sections WHERE paper_id = ?")
      .bind(paperId)
      .all();
    expect(sections.results.length).toBe(0);
  });

  it("deleteCitationsBySourcePaperId removes citations", async () => {
    await deleteCitationsBySourcePaperId(env.DB, paperId);
    const citations = await env.DB.prepare("SELECT * FROM citations WHERE source_paper_id = ?")
      .bind(paperId)
      .all();
    expect(citations.results.length).toBe(0);
  });
});
