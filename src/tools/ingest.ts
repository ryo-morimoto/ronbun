import type { Env, QueueMessage, PaperRow } from "../types.ts";
import { ingestPaperInput, batchIngestInput } from "../schemas.ts";
import { generateId } from "../lib/id.ts";
import { searchArxivPapers } from "../lib/arxiv.ts";

export async function ingestPaper(env: Env, input: unknown) {
  try {
    const parsed = ingestPaperInput.parse(input);
    const { arxivId } = parsed;

    const existing = await env.DB.prepare(
      "SELECT id, arxiv_id, status FROM papers WHERE arxiv_id = ?",
    )
      .bind(arxivId)
      .first<Pick<PaperRow, "id" | "arxiv_id" | "status">>();

    if (existing) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: existing.status,
              paperId: existing.id,
              message: "Paper already exists",
            }),
          },
        ],
      };
    }

    const paperId = generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO papers (id, arxiv_id, status, created_at)
       VALUES (?, ?, 'queued', ?)`,
    )
      .bind(paperId, arxivId, now)
      .run();

    const queueMessage: QueueMessage = {
      paperId,
      arxivId,
      step: "metadata",
    };
    await env.INGEST_QUEUE.send(queueMessage);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "queued", paperId }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }
}

export async function batchIngest(env: Env, input: unknown) {
  try {
    const parsed = batchIngestInput.parse(input);
    let arxivIds: string[] = [];

    if (parsed.searchQuery) {
      arxivIds = await searchArxivPapers(parsed.searchQuery, 50);
    }

    if (parsed.arxivIds) {
      for (const id of parsed.arxivIds) {
        if (!arxivIds.includes(id)) {
          arxivIds.push(id);
        }
      }
    }

    arxivIds = arxivIds.slice(0, 50);

    const results: Array<{
      arxivId: string;
      status: string;
      paperId?: string;
      error?: string;
    }> = [];

    for (const arxivId of arxivIds) {
      const response = await ingestPaper(env, { arxivId });
      const responseData = JSON.parse(response.content[0].text);

      if (responseData.error) {
        results.push({ arxivId, status: "error", error: responseData.error });
      } else {
        results.push({
          arxivId,
          status: responseData.status,
          paperId: responseData.paperId,
        });
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ results, total: results.length }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }
}
