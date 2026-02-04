import type { SectionRow } from "@ronbun/types";

export async function getSectionsByPaperId(db: D1Database, paperId: string): Promise<SectionRow[]> {
  const result = await db
    .prepare("SELECT * FROM sections WHERE paper_id = ? ORDER BY position")
    .bind(paperId)
    .all<SectionRow>();
  return result.results || [];
}

export async function insertSection(
  db: D1Database,
  id: string,
  paperId: string,
  heading: string,
  level: number,
  content: string,
  position: number,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, paperId, heading, level, content, position)
    .run();
}

export async function getSectionsForExtraction(
  db: D1Database,
  paperId: string,
  limit = 10,
): Promise<Array<{ id: string; heading: string; content: string }>> {
  const result = await db
    .prepare(
      "SELECT id, heading, content FROM sections WHERE paper_id = ? ORDER BY position LIMIT ?",
    )
    .bind(paperId, limit)
    .all<{ id: string; heading: string; content: string }>();
  return result.results;
}
