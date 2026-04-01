import type { CitationRow } from "@ronbun/types";

export async function getCitationsBySource(
  db: D1Database,
  paperId: string,
): Promise<CitationRow[]> {
  const result = await db
    .prepare("SELECT * FROM citations WHERE source_paper_id = ?")
    .bind(paperId)
    .all<CitationRow>();
  return result.results || [];
}

export async function getCitedBy(
  db: D1Database,
  paperId: string,
): Promise<Array<CitationRow & { source_title: string; source_arxiv_id: string }>> {
  const result = await db
    .prepare(
      `SELECT c.*, p.title as source_title, p.arxiv_id as source_arxiv_id
       FROM citations c
       JOIN papers p ON p.id = c.source_paper_id
       WHERE c.target_paper_id = ?`,
    )
    .bind(paperId)
    .all();
  return result.results as any;
}

export async function getCitationCounts(
  db: D1Database,
  paperIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (paperIds.length === 0) return counts;

  const placeholders = paperIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT target_paper_id, COUNT(*) as count
       FROM citations
       WHERE target_paper_id IN (${placeholders})
       GROUP BY target_paper_id`,
    )
    .bind(...paperIds)
    .all<{ target_paper_id: string; count: number }>();

  for (const row of result.results) {
    counts.set(row.target_paper_id, row.count);
  }
  return counts;
}

export async function insertCitation(
  db: D1Database,
  id: string,
  sourcePaperId: string,
  targetPaperId: string | null,
  targetArxivId: string | null,
  targetTitle: string | null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO citations (id, source_paper_id, target_paper_id, target_arxiv_id, target_title) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, sourcePaperId, targetPaperId, targetArxivId, targetTitle)
    .run();
}

export async function findPaperIdByArxivId(
  db: D1Database,
  arxivId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM papers WHERE arxiv_id = ?")
    .bind(arxivId)
    .first<{ id: string }>();
  return row?.id ?? null;
}
