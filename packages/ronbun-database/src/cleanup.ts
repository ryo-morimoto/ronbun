export async function deleteAuthorLinksByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db
    .prepare("DELETE FROM entity_links WHERE paper_id = ? AND entity_type = 'author'")
    .bind(paperId)
    .run();
}

export async function deleteSectionsByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db.prepare("DELETE FROM sections WHERE paper_id = ?").bind(paperId).run();
}

export async function deleteCitationsBySourcePaperId(
  db: D1Database,
  paperId: string,
): Promise<void> {
  await db.prepare("DELETE FROM citations WHERE source_paper_id = ?").bind(paperId).run();
}

export async function deleteExtractionsByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db.prepare("DELETE FROM extractions WHERE paper_id = ?").bind(paperId).run();
}

export async function deleteNonAuthorEntityLinksByPaperId(
  db: D1Database,
  paperId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM entity_links WHERE paper_id = ? AND entity_type IN ('method', 'dataset')")
    .bind(paperId)
    .run();
}
