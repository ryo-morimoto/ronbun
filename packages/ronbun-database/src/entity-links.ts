export async function insertEntityLink(
  db: D1Database,
  id: string,
  paperId: string,
  entityType: "method" | "dataset" | "author",
  entityName: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, ?, ?)",
    )
    .bind(id, paperId, entityType, entityName)
    .run();
}

export async function getRelatedPapers(
  db: D1Database,
  paperId: string,
  limit = 20,
): Promise<
  Array<{
    paper_id: string;
    title: string;
    arxiv_id: string;
    entity_type: string;
    entity_name: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT DISTINCT el2.paper_id, p.title, p.arxiv_id, el.entity_type, el.entity_name
       FROM entity_links el
       JOIN entity_links el2 ON el.entity_type = el2.entity_type
         AND el.entity_name = el2.entity_name
         AND el.paper_id != el2.paper_id
       JOIN papers p ON p.id = el2.paper_id
       WHERE el.paper_id = ?
       LIMIT ?`,
    )
    .bind(paperId, limit)
    .all();
  return result.results as any;
}

export async function findSharedEntities(
  db: D1Database,
  paperId: string,
  entityType: "method" | "dataset" | "author",
): Promise<
  Array<{
    paper_id: string;
    title: string;
    arxiv_id: string;
    entity_name: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT DISTINCT el2.paper_id, p.title, p.arxiv_id, el.entity_name
       FROM entity_links el
       JOIN entity_links el2 ON el.entity_type = el2.entity_type
         AND el.entity_name = el2.entity_name
         AND el.paper_id != el2.paper_id
       JOIN papers p ON p.id = el2.paper_id
       WHERE el.paper_id = ? AND el.entity_type = ?`,
    )
    .bind(paperId, entityType)
    .all();
  return result.results as any;
}
