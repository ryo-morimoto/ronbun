import { fetchNewPapers, generateId } from "@ronbun/arxiv";
import { findExistingArxivIds, insertPapersBatch } from "@ronbun/database";
import type { QueueMessage } from "@ronbun/types";
import { createRonbunContext } from "./context";

const QUEUE_BATCH_SIZE = 100;

export async function handleScheduled(env: Env): Promise<void> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate = yesterday.toISOString().split("T")[0];
  const untilDate = fromDate;

  console.log(`Cron: fetching all papers for ${fromDate}`);

  const arxivIds = await fetchNewPapers(fromDate, untilDate);
  console.log(`Cron: found ${arxivIds.length} papers from OAI-PMH`);

  if (arxivIds.length === 0) return;

  const ctx = createRonbunContext(env);

  // Batch check for existing papers
  const existing = await findExistingArxivIds(ctx.db, arxivIds);
  const newIds = arxivIds.filter((id) => !existing.has(id));
  console.log(`Cron: ${newIds.length} new, ${existing.size} already in DB`);

  if (newIds.length === 0) return;

  // Batch insert papers
  const papers = newIds.map((arxivId) => ({ id: generateId(), arxivId }));
  await insertPapersBatch(ctx.db, papers);

  // Send queue messages in batches
  for (let i = 0; i < papers.length; i += QUEUE_BATCH_SIZE) {
    const batch = papers.slice(i, i + QUEUE_BATCH_SIZE);
    await ctx.queue.sendBatch(
      batch.map((p) => ({
        body: { paperId: p.id, arxivId: p.arxivId, step: "metadata" } satisfies QueueMessage,
      })),
    );
  }

  console.log(`Cron: queued ${newIds.length} papers for ingestion`);
}
