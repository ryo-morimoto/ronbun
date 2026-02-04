import type { Env } from "./env.ts";
import type { RonbunContext } from "@ronbun/api";
import { ingestPaper } from "@ronbun/api";
import { fetchNewPapersByCategory } from "@ronbun/arxiv";

function createContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}

export async function handleScheduled(env: Env): Promise<void> {
  const categories = env.ARXIV_CATEGORIES
    ? env.ARXIV_CATEGORIES.split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  if (categories.length === 0) {
    console.log("No ARXIV_CATEGORIES configured, skipping cron");
    return;
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate = yesterday.toISOString().split("T")[0];
  const untilDate = fromDate;

  console.log(`Cron: fetching papers for ${fromDate}, categories: ${categories.join(", ")}`);

  const arxivIds = await fetchNewPapersByCategory(categories, fromDate, untilDate);
  console.log(`Cron: found ${arxivIds.length} papers from OAI-PMH`);

  const ctx = createContext(env);
  let queued = 0;
  let skipped = 0;

  for (const arxivId of arxivIds) {
    try {
      const result = await ingestPaper(ctx, { arxivId });
      if (result.message === "Paper already exists") {
        skipped++;
      } else {
        queued++;
      }
    } catch (error) {
      console.error(`Cron: failed to ingest ${arxivId}:`, error);
    }
  }

  console.log(`Cron: queued ${queued}, skipped ${skipped} (already in DB)`);
}
