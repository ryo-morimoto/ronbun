import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { ingestPaperInput, batchIngestInput } from "@ronbun/schemas";
import { generateId, searchArxivPapers } from "@ronbun/arxiv";
import { findPaperByArxivId, insertPaper } from "@ronbun/database";

export type IngestResult = {
  status: string;
  paperId: string;
  message?: string;
};

export async function ingestPaper(
  ctx: RonbunContext,
  input: { arxivId: string },
): Promise<IngestResult> {
  const parsed = ingestPaperInput.parse(input);
  const existing = await findPaperByArxivId(ctx.db, parsed.arxivId);

  if (existing) {
    if (existing.status === "failed") {
      // Delete the failed paper and re-ingest
      await ctx.db.prepare("DELETE FROM papers WHERE id = ?").bind(existing.id).run();
    } else {
      return {
        status: existing.status,
        paperId: existing.id,
        message: "Paper already exists",
      };
    }
  }

  const paperId = generateId();
  await insertPaper(ctx.db, paperId, parsed.arxivId);

  const queueMessage: QueueMessage = {
    paperId,
    arxivId: parsed.arxivId,
    step: "metadata",
  };
  await ctx.queue.send(queueMessage);

  return { status: "queued", paperId };
}

export type BatchIngestResult = {
  results: Array<{
    arxivId: string;
    status: string;
    paperId?: string;
    error?: string;
  }>;
  total: number;
};

export async function batchIngest(
  ctx: RonbunContext,
  input: { arxivIds?: string[]; searchQuery?: string },
): Promise<BatchIngestResult> {
  const parsed = batchIngestInput.parse(input);
  let arxivIds: string[] = [];

  if (parsed.searchQuery) {
    arxivIds = await searchArxivPapers(parsed.searchQuery, 50);
  }
  if (parsed.arxivIds) {
    for (const id of parsed.arxivIds) {
      if (!arxivIds.includes(id)) arxivIds.push(id);
    }
  }
  arxivIds = arxivIds.slice(0, 50);

  const results: BatchIngestResult["results"] = [];
  for (const arxivId of arxivIds) {
    try {
      const result = await ingestPaper(ctx, { arxivId });
      results.push({ arxivId, status: result.status, paperId: result.paperId });
    } catch (error) {
      results.push({
        arxivId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, total: results.length };
}
