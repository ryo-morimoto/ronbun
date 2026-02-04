import type { PaperRow, PaperStatus } from "@ronbun/types";

export async function findPaperByArxivId(
  db: D1Database,
  arxivId: string,
): Promise<Pick<PaperRow, "id" | "arxiv_id" | "status"> | null> {
  return db
    .prepare("SELECT id, arxiv_id, status FROM papers WHERE arxiv_id = ?")
    .bind(arxivId)
    .first<Pick<PaperRow, "id" | "arxiv_id" | "status">>();
}

export async function insertPaper(db: D1Database, id: string, arxivId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)")
    .bind(id, arxivId, now)
    .run();
}

export async function updatePaperMetadata(
  db: D1Database,
  paperId: string,
  metadata: {
    title: string;
    authors: string[];
    abstract: string;
    categories: string[];
    publishedAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE papers
       SET title = ?, authors = ?, abstract = ?, categories = ?,
           published_at = ?, updated_at = ?, status = 'metadata'
       WHERE id = ?`,
    )
    .bind(
      metadata.title,
      JSON.stringify(metadata.authors),
      metadata.abstract,
      JSON.stringify(metadata.categories),
      metadata.publishedAt,
      metadata.updatedAt,
      paperId,
    )
    .run();
}

export async function updatePaperStatus(
  db: D1Database,
  paperId: string,
  status: PaperStatus,
): Promise<void> {
  await db.prepare("UPDATE papers SET status = ? WHERE id = ?").bind(status, paperId).run();
}

export async function markPaperReady(db: D1Database, paperId: string): Promise<void> {
  await db
    .prepare("UPDATE papers SET status = 'ready', ingested_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), paperId)
    .run();
}

export async function markPaperFailed(
  db: D1Database,
  paperId: string,
  error: unknown,
): Promise<void> {
  await db
    .prepare("UPDATE papers SET status = 'failed', error = ? WHERE id = ?")
    .bind(String(error), paperId)
    .run();
}

export async function updatePaperError(
  db: D1Database,
  paperId: string,
  errorJson: string,
): Promise<void> {
  await db.prepare("UPDATE papers SET error = ? WHERE id = ?").bind(errorJson, paperId).run();
}

export async function getPaperById(db: D1Database, id: string): Promise<PaperRow | null> {
  return db
    .prepare("SELECT * FROM papers WHERE id = ? OR arxiv_id = ?")
    .bind(id, id)
    .first<PaperRow>();
}

export async function getPaperArxivId(db: D1Database, paperId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT arxiv_id FROM papers WHERE id = ?")
    .bind(paperId)
    .first<{ arxiv_id: string }>();
  return row?.arxiv_id ?? null;
}

export async function listPapers(
  db: D1Database,
  opts: {
    category?: string;
    year?: number;
    status?: PaperStatus;
    sortBy: string;
    sortOrder: string;
    cursor?: string;
    limit: number;
  },
): Promise<{ papers: PaperRow[]; hasMore: boolean }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.category) {
    conditions.push(`categories LIKE '%"' || ? || '"%'`);
    params.push(opts.category);
  }
  if (opts.year) {
    conditions.push(`published_at LIKE ? || '%'`);
    params.push(opts.year.toString());
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.cursor) {
    if (opts.sortOrder === "desc") {
      conditions.push(
        `(${opts.sortBy} < (SELECT ${opts.sortBy} FROM papers WHERE id = ?) OR (${opts.sortBy} = (SELECT ${opts.sortBy} FROM papers WHERE id = ?) AND id < ?))`,
      );
      params.push(opts.cursor, opts.cursor, opts.cursor);
    } else {
      conditions.push(
        `(${opts.sortBy} > (SELECT ${opts.sortBy} FROM papers WHERE id = ?) OR (${opts.sortBy} = (SELECT ${opts.sortBy} FROM papers WHERE id = ?) AND id > ?))`,
      );
      params.push(opts.cursor, opts.cursor, opts.cursor);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM papers ${whereClause} ORDER BY ${opts.sortBy} ${opts.sortOrder}, id ${opts.sortOrder} LIMIT ?`;
  params.push(opts.limit + 1);

  const result = await db
    .prepare(query)
    .bind(...params)
    .all<PaperRow>();
  const papers = result.results || [];
  const hasMore = papers.length > opts.limit;
  if (hasMore) papers.pop();

  return { papers, hasMore };
}

export async function searchPapersFts(
  db: D1Database,
  query: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    arxiv_id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
       FROM papers_fts f JOIN papers p ON p.rowid = f.rowid
       WHERE papers_fts MATCH ? AND p.status = 'ready'
       ORDER BY rank LIMIT ?`,
    )
    .bind(query, limit)
    .all();
  return result.results as any;
}

export async function searchSectionsFts(
  db: D1Database,
  query: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    arxiv_id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT DISTINCT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
       FROM sections_fts f JOIN sections s ON s.rowid = f.rowid
       JOIN papers p ON p.id = s.paper_id
       WHERE sections_fts MATCH ? AND p.status = 'ready' LIMIT ?`,
    )
    .bind(query, limit)
    .all();
  return result.results as any;
}

export async function fetchPapersByIds(db: D1Database, ids: string[]): Promise<PaperRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db
    .prepare(`SELECT * FROM papers WHERE id IN (${placeholders}) AND status = 'ready'`)
    .bind(...ids)
    .all<PaperRow>();
  return result.results;
}
