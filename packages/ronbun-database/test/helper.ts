const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS papers (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_papers_arxiv_id ON papers(arxiv_id)`,
  `CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_papers_published_at ON papers(published_at)`,

  `CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_sections_paper_id ON sections(paper_id)`,

  `CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('method', 'dataset', 'baseline', 'metric', 'result', 'contribution', 'limitation')),
  name TEXT NOT NULL,
  detail TEXT,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_extractions_paper_id ON extractions(paper_id)`,
  `CREATE INDEX IF NOT EXISTS idx_extractions_type ON extractions(type)`,
  `CREATE INDEX IF NOT EXISTS idx_extractions_name ON extractions(name)`,

  `CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  target_paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  target_arxiv_id TEXT,
  target_doi TEXT,
  target_title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_paper_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_target ON citations(target_paper_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_target_arxiv ON citations(target_arxiv_id)`,

  `CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('method', 'dataset', 'author')),
  entity_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_paper_id ON entity_links(paper_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_entity ON entity_links(entity_type, entity_name)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  title,
  abstract,
  content=papers,
  content_rowid=rowid,
  tokenize='porter unicode61'
)`,
  `CREATE TRIGGER IF NOT EXISTS papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, title, abstract) VALUES (NEW.rowid, NEW.title, NEW.abstract);
END`,
  `CREATE TRIGGER IF NOT EXISTS papers_fts_update AFTER UPDATE OF title, abstract ON papers BEGIN
  INSERT INTO papers_fts(papers_fts, rowid, title, abstract) VALUES ('delete', OLD.rowid, OLD.title, OLD.abstract);
  INSERT INTO papers_fts(rowid, title, abstract) VALUES (NEW.rowid, NEW.title, NEW.abstract);
END`,
  `CREATE TRIGGER IF NOT EXISTS papers_fts_delete AFTER DELETE ON papers BEGIN
  INSERT INTO papers_fts(papers_fts, rowid, title, abstract) VALUES ('delete', OLD.rowid, OLD.title, OLD.abstract);
END`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading,
  content,
  content=sections,
  content_rowid=rowid,
  tokenize='porter unicode61'
)`,
  `CREATE TRIGGER IF NOT EXISTS sections_fts_insert AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, heading, content) VALUES (NEW.rowid, NEW.heading, NEW.content);
END`,
  `CREATE TRIGGER IF NOT EXISTS sections_fts_update AFTER UPDATE OF heading, content ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, heading, content) VALUES ('delete', OLD.rowid, OLD.heading, OLD.content);
  INSERT INTO sections_fts(rowid, heading, content) VALUES (NEW.rowid, NEW.heading, NEW.content);
END`,
  `CREATE TRIGGER IF NOT EXISTS sections_fts_delete AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, heading, content) VALUES ('delete', OLD.rowid, OLD.heading, OLD.content);
END`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS extractions_fts USING fts5(
  name,
  detail,
  content=extractions,
  content_rowid=rowid,
  tokenize='porter unicode61'
)`,
  `CREATE TRIGGER IF NOT EXISTS extractions_fts_insert AFTER INSERT ON extractions BEGIN
  INSERT INTO extractions_fts(rowid, name, detail) VALUES (NEW.rowid, NEW.name, NEW.detail);
END`,
  `CREATE TRIGGER IF NOT EXISTS extractions_fts_update AFTER UPDATE OF name, detail ON extractions BEGIN
  INSERT INTO extractions_fts(extractions_fts, rowid, name, detail) VALUES ('delete', OLD.rowid, OLD.name, OLD.detail);
  INSERT INTO extractions_fts(rowid, name, detail) VALUES (NEW.rowid, NEW.name, NEW.detail);
END`,
  `CREATE TRIGGER IF NOT EXISTS extractions_fts_delete AFTER DELETE ON extractions BEGIN
  INSERT INTO extractions_fts(extractions_fts, rowid, name, detail) VALUES ('delete', OLD.rowid, OLD.name, OLD.detail);
END`,
];

export async function applyMigration(db: D1Database) {
  for (const stmt of MIGRATION_STATEMENTS) {
    await db.prepare(stmt).run();
  }
}
