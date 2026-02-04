import type { ExtractionRow } from "@ronbun/types";

export async function getExtractionsByPaperId(
  db: D1Database,
  paperId: string,
): Promise<ExtractionRow[]> {
  const result = await db
    .prepare("SELECT * FROM extractions WHERE paper_id = ? ORDER BY type, name")
    .bind(paperId)
    .all<ExtractionRow>();
  return result.results || [];
}

export async function insertExtraction(
  db: D1Database,
  id: string,
  paperId: string,
  type: string,
  name: string,
  detail: string | null,
  sectionId: string | null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO extractions (id, paper_id, type, name, detail, section_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, paperId, type, name, detail, sectionId)
    .run();
}

export async function searchExtractionsFts(
  db: D1Database,
  query: string,
  type: string | null,
  limit: number,
): Promise<
  Array<{
    id: string;
    paper_id: string;
    type: string;
    name: string;
    detail: string | null;
    paper_title: string;
    arxiv_id: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT e.id, e.paper_id, e.type, e.name, e.detail, p.title as paper_title, p.arxiv_id
       FROM extractions_fts f JOIN extractions e ON e.rowid = f.rowid
       JOIN papers p ON p.id = e.paper_id
       WHERE extractions_fts MATCH ?
       AND (? IS NULL OR e.type = ?)
       ORDER BY rank LIMIT ?`,
    )
    .bind(query, type, type, limit)
    .all();
  return result.results as any;
}
