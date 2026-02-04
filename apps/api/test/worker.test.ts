import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  arxiv_id TEXT NOT NULL UNIQUE,
  title TEXT,
  authors TEXT,
  abstract TEXT,
  categories TEXT,
  published_at TEXT,
  updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'metadata', 'parsed', 'extracted', 'ready', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ingested_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_papers_arxiv_id ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sections_paper_id ON sections(paper_id);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('method', 'dataset', 'baseline', 'metric', 'result', 'contribution', 'limitation')),
  name TEXT NOT NULL,
  detail TEXT,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_extractions_paper_id ON extractions(paper_id);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  target_paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  target_arxiv_id TEXT,
  target_doi TEXT,
  target_title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_paper_id);
CREATE INDEX IF NOT EXISTS idx_citations_target ON citations(target_paper_id);

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('method', 'dataset', 'author')),
  entity_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_entity_links_paper_id ON entity_links(paper_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_entity ON entity_links(entity_type, entity_name);
`;

async function applyMigration(db: D1Database) {
  const statements = MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

async function seedTestData(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO papers (id, arxiv_id, title, authors, abstract, categories, published_at, status, created_at, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    )
    .bind(
      "paper-1",
      "2401.15884",
      "Corrective Retrieval Augmented Generation",
      '["Shi-Qi Yan","Jia-Chen Gu"]',
      "Large language models inevitably exhibit hallucinations. Retrieval-augmented generation is a practical approach.",
      '["cs.CL","cs.AI"]',
      "2024-01-28T00:00:00Z",
      "2024-01-28T00:00:00Z",
      "2024-01-28T01:00:00Z",
    )
    .run();

  await db
    .prepare(
      `INSERT INTO papers (id, arxiv_id, title, authors, abstract, categories, published_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    )
    .bind(
      "paper-2",
      "2312.10997",
      "Self-RAG: Learning to Retrieve",
      '["Akari Asai"]',
      "We introduce a new framework called Self-RAG that adaptively retrieves passages.",
      '["cs.CL"]',
      "2023-12-15T00:00:00Z",
      "2023-12-15T00:00:00Z",
    )
    .run();

  await db
    .prepare(
      `INSERT INTO papers (id, arxiv_id, title, status, created_at)
     VALUES (?, ?, ?, 'queued', ?)`,
    )
    .bind("paper-3", "2405.00001", "Queued Paper", "2024-05-01T00:00:00Z")
    .run();

  await db
    .prepare(
      `INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "sec-1",
      "paper-1",
      "Introduction",
      1,
      "This paper introduces CRAG for corrective retrieval.",
      0,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind("sec-2", "paper-1", "Methods", 2, "We propose a lightweight retrieval evaluator.", 1)
    .run();

  await db
    .prepare(
      `INSERT INTO extractions (id, paper_id, type, name, detail, section_id) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind("ext-1", "paper-1", "method", "CRAG", "Corrective retrieval augmented generation", "sec-2")
    .run();

  await db
    .prepare(
      `INSERT INTO extractions (id, paper_id, type, name, detail, section_id) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind("ext-2", "paper-1", "dataset", "PopQA", "Open-domain QA benchmark", "sec-2")
    .run();

  await db
    .prepare(
      `INSERT INTO citations (id, source_paper_id, target_paper_id, target_arxiv_id, target_title) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind("cit-1", "paper-1", "paper-2", "2312.10997", "Self-RAG: Learning to Retrieve")
    .run();

  await db
    .prepare(
      `INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, ?, ?)`,
    )
    .bind("el-1", "paper-1", "method", "RAG")
    .run();

  await db
    .prepare(
      `INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, ?, ?)`,
    )
    .bind("el-2", "paper-2", "method", "RAG")
    .run();

  await db
    .prepare(
      `INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, ?, ?)`,
    )
    .bind("el-3", "paper-1", "author", "Shi-Qi Yan")
    .run();
}

describe("D1 database operations", () => {
  beforeAll(async () => {
    await applyMigration(env.DB);
    await seedTestData(env.DB);
  });

  describe("papers table", () => {
    it("queries paper by arxiv_id", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM papers WHERE arxiv_id = ?",
      )
        .bind("2401.15884")
        .first();
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Corrective Retrieval Augmented Generation");
      expect(result!.status).toBe("ready");
    });

    it("queries paper by id", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM papers WHERE id = ?",
      )
        .bind("paper-1")
        .first();
      expect(result).not.toBeNull();
      expect(result!.arxiv_id).toBe("2401.15884");
    });

    it("filters papers by status", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM papers WHERE status = ?",
      )
        .bind("ready")
        .all();
      expect(result.results.length).toBe(2);
    });

    it("returns null for non-existent paper", async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM papers WHERE arxiv_id = ?",
      )
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
        env.DB.prepare(
          "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, ?, ?)",
        )
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
      expect(page2.results.length).toBe(1);
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
      const result = await env.DB.prepare(
        "SELECT * FROM citations WHERE source_paper_id = ?",
      )
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
      const paper = await env.DB.prepare(
        "SELECT * FROM papers WHERE id = ?",
      )
        .bind("paper-1")
        .first();
      expect(paper).not.toBeNull();

      const sections = await env.DB.prepare(
        "SELECT * FROM sections WHERE paper_id = ? ORDER BY position",
      )
        .bind("paper-1")
        .all();
      expect(sections.results.length).toBe(2);

      const extractions = await env.DB.prepare(
        "SELECT * FROM extractions WHERE paper_id = ?",
      )
        .bind("paper-1")
        .all();
      expect(extractions.results.length).toBe(2);

      const citations = await env.DB.prepare(
        "SELECT * FROM citations WHERE source_paper_id = ?",
      )
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
        .bind("paper-new", "2406.00001", "2024-06-01T00:00:00Z")
        .run();

      let paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-new")
        .first();
      expect(paper!.status).toBe("queued");

      await env.DB.prepare("UPDATE papers SET status = 'metadata', title = ? WHERE id = ?")
        .bind("New Paper Title", "paper-new")
        .run();

      paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?")
        .bind("paper-new")
        .first();
      expect(paper!.status).toBe("metadata");
      expect(paper!.title).toBe("New Paper Title");
    });

    it("marks paper as failed with error", async () => {
      await env.DB.prepare(
        "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
      )
        .bind("paper-fail", "2407.00001", "2024-07-01T00:00:00Z")
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
