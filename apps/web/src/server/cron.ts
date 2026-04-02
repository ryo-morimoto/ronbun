import { fetchNewPapersWithMetadata, generateId } from "@ronbun/arxiv";
import { findExistingArxivIds, insertPapersWithMetadataBatch } from "@ronbun/database";
import type { PaperInsert } from "@ronbun/database";
import { batchEmbedPapers } from "@ronbun/vector";

export async function handleScheduled(env: Env): Promise<void> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate = yesterday.toISOString().split("T")[0];
  const untilDate = fromDate;

  console.log(`Cron: fetching all papers for ${fromDate}`);

  const records = await fetchNewPapersWithMetadata(fromDate, untilDate);
  console.log(`Cron: found ${records.length} papers from OAI-PMH`);

  if (records.length === 0) return;

  // Batch check for existing papers
  const existing = await findExistingArxivIds(
    env.DB,
    records.map((r) => r.arxivId),
  );
  const newRecords = records.filter((r) => !existing.has(r.arxivId));
  console.log(`Cron: ${newRecords.length} new, ${existing.size} already in DB`);

  if (newRecords.length === 0) return;

  // Batch insert papers with metadata + author entity_links
  const papers: PaperInsert[] = newRecords.map((r) => ({
    id: generateId(),
    arxivId: r.arxivId,
    title: r.title,
    authors: r.authors,
    abstract: r.abstract,
    categories: r.categories,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  }));
  await insertPapersWithMetadataBatch(env.DB, papers);

  // Batch embed abstracts
  const papersWithAbstract = papers
    .filter((p) => p.abstract)
    .map((p) => ({ id: p.id, abstract: p.abstract }));
  const embedded = await batchEmbedPapers(env.VECTOR_INDEX, env.AI, papersWithAbstract);
  console.log(`Cron: embedded ${embedded} abstracts`);

  // Send to DO alarm scheduler for rate-controlled content fetching
  const batchId = `${fromDate}-${Date.now()}`;
  const scheduler = env.ARXIV_FETCH_SCHEDULER.get(env.ARXIV_FETCH_SCHEDULER.idFromName("default"));
  await scheduler.fetch("https://do/add-batch", {
    method: "POST",
    body: JSON.stringify({
      batchId,
      items: papers.map((p) => ({ paperId: p.id, arxivId: p.arxivId })),
    }),
  });

  console.log(`Cron: queued ${papers.length} papers for content fetch via DO scheduler`);
}
