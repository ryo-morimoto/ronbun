import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { queueMessageSchema } from "@ronbun/schemas";
import {
  fetchArxivMetadata,
  fetchArxivHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
  generateId,
} from "@ronbun/arxiv";
import {
  updatePaperMetadata,
  updatePaperStatus,
  markPaperReady,
  getPaperArxivId,
  insertSection,
  insertExtraction,
  insertEntityLink,
  getSectionsForExtraction,
  findPaperIdByArxivId,
  insertCitation,
  deleteAuthorLinksByPaperId,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
  deleteExtractionsByPaperId,
  deleteNonAuthorEntityLinksByPaperId,
} from "@ronbun/database";
import { storeHtml, storePdf } from "@ronbun/storage";
import { upsertSectionEmbeddings } from "@ronbun/vector";

export async function processQueueMessage(
  ctx: RonbunContext,
  message: QueueMessage,
): Promise<void> {
  const parsed = queueMessageSchema.parse(message);
  switch (parsed.step) {
    case "metadata":
      return processMetadata(ctx, parsed.arxivId, parsed.paperId);
    case "content":
      return processContent(ctx, parsed.arxivId, parsed.paperId);
    case "extraction":
      return processExtraction(ctx, parsed.paperId);
    case "embedding":
      return processEmbedding(ctx, parsed.paperId);
  }
}

async function processMetadata(ctx: RonbunContext, arxivId: string, paperId: string): Promise<void> {
  await deleteAuthorLinksByPaperId(ctx.db, paperId);

  const metadata = await fetchArxivMetadata(arxivId);
  await updatePaperMetadata(ctx.db, paperId, metadata);

  for (const author of metadata.authors) {
    await insertEntityLink(ctx.db, generateId(), paperId, "author", author);
  }

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "content",
  } satisfies QueueMessage);
}

async function processContent(ctx: RonbunContext, arxivId: string, paperId: string): Promise<void> {
  await deleteSectionsByPaperId(ctx.db, paperId);
  await deleteCitationsBySourcePaperId(ctx.db, paperId);

  let parsedContent;

  const htmlContent = await fetchArxivHtml(arxivId);
  if (htmlContent) {
    await storeHtml(ctx.storage, arxivId, htmlContent);
    parsedContent = parseHtmlContent(htmlContent);
  }

  if (!parsedContent) {
    const pdfBuffer = await fetchArxivPdf(arxivId);
    if (pdfBuffer) {
      await storePdf(ctx.storage, arxivId, pdfBuffer);
      const textContent = new TextDecoder().decode(pdfBuffer);
      parsedContent = parsePdfText(textContent);
    }
  }

  if (!parsedContent) {
    throw new Error("Failed to fetch paper content (HTML and PDF both failed)");
  }

  for (const section of parsedContent.sections) {
    await insertSection(
      ctx.db,
      generateId(),
      paperId,
      section.heading,
      section.level,
      section.content,
      section.position,
    );
  }

  for (const ref of parsedContent.references) {
    if (ref.arxivId) {
      const targetPaperId = await findPaperIdByArxivId(ctx.db, ref.arxivId);
      await insertCitation(ctx.db, generateId(), paperId, targetPaperId, ref.arxivId, ref.title);
    }
  }

  await updatePaperStatus(ctx.db, paperId, "parsed");

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "extraction",
  } satisfies QueueMessage);
}

async function processExtraction(ctx: RonbunContext, paperId: string): Promise<void> {
  await deleteExtractionsByPaperId(ctx.db, paperId);
  await deleteNonAuthorEntityLinksByPaperId(ctx.db, paperId);

  const sections = await getSectionsForExtraction(ctx.db, paperId, 10);

  for (const section of sections) {
    const prompt = `Extract structured knowledge from this research paper section as JSON.

Section: ${section.heading}
Content: ${section.content.slice(0, 4000)}

Extract the following as JSON arrays with {name, detail} objects:
- methods: research methods or techniques used
- datasets: datasets mentioned
- baselines: baseline methods compared against
- metrics: evaluation metrics
- results: key numerical or qualitative results
- contributions: main contributions claimed
- limitations: limitations discussed

Return only valid JSON with these keys.`;

    try {
      const response = await ctx.ai.run(
        "@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0],
        {
          messages: [{ role: "user" as const, content: prompt }],
        },
      );

      const responseText =
        typeof response === "string"
          ? response
          : "response" in (response as Record<string, unknown>)
            ? ((response as Record<string, unknown>).response as string)
            : "";

      const extracted = JSON.parse(responseText || "{}");

      const types = [
        "methods",
        "datasets",
        "baselines",
        "metrics",
        "results",
        "contributions",
        "limitations",
      ] as const;
      const typeMap: Record<string, string> = {
        methods: "method",
        datasets: "dataset",
        baselines: "baseline",
        metrics: "metric",
        results: "result",
        contributions: "contribution",
        limitations: "limitation",
      };

      for (const key of types) {
        const items = extracted[key];
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item?.name) {
              await insertExtraction(
                ctx.db,
                generateId(),
                paperId,
                typeMap[key],
                item.name,
                item.detail ?? null,
                section.id,
              );
              if (key === "methods" || key === "datasets") {
                await insertEntityLink(
                  ctx.db,
                  generateId(),
                  paperId,
                  typeMap[key] as "method" | "dataset",
                  item.name,
                );
              }
            }
          }
        }
      }
    } catch (aiError) {
      console.error("AI extraction failed for section:", section.id, aiError);
    }
  }

  await updatePaperStatus(ctx.db, paperId, "extracted");

  const arxivId = await getPaperArxivId(ctx.db, paperId);
  if (!arxivId) throw new Error(`Paper not found: ${paperId}`);

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "embedding",
  } satisfies QueueMessage);
}

async function processEmbedding(ctx: RonbunContext, paperId: string): Promise<void> {
  const sections = await getSectionsForExtraction(ctx.db, paperId, 100);
  await upsertSectionEmbeddings(ctx.vectorIndex, ctx.ai, paperId, sections);
  await markPaperReady(ctx.db, paperId);
}
