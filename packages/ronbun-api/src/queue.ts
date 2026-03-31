import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { queueMessageSchema, aiExtractionSchema } from "@ronbun/schemas";
import {
  fetchArxivMetadata,
  fetchArxivHtml,
  fetchArxivNativeHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
  extractPdfText,
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

async function processMetadata(
  ctx: RonbunContext,
  arxivId: string,
  paperId: string,
): Promise<void> {
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

  // Tier 1: ar5iv HTML (best quality, ~77% coverage)
  const htmlContent = await fetchArxivHtml(arxivId);
  if (htmlContent) {
    await storeHtml(ctx.storage, arxivId, htmlContent);
    parsedContent = parseHtmlContent(htmlContent);
  }

  // Tier 2: arXiv native HTML (post-Dec 2023 papers)
  if (!parsedContent) {
    const nativeHtml = await fetchArxivNativeHtml(arxivId);
    if (nativeHtml) {
      await storeHtml(ctx.storage, arxivId, nativeHtml);
      parsedContent = parseHtmlContent(nativeHtml);
    }
  }

  // Tier 3: PDF text extraction via pdf-oxide-wasm (XY-Cut reading order)
  if (!parsedContent) {
    const pdfBuffer = await fetchArxivPdf(arxivId);
    if (pdfBuffer) {
      await storePdf(ctx.storage, arxivId, pdfBuffer);
      const textContent = await extractPdfText(pdfBuffer);
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

      const jsonText = stripMarkdownFences(responseText || "{}");
      const parsed = safeJsonParse(jsonText);
      if (!parsed) {
        console.error(
          "AI extraction returned unparseable JSON for section:",
          section.id,
          "raw:",
          responseText,
        );
        continue;
      }

      const result = aiExtractionSchema.safeParse(parsed);
      if (!result.success) {
        console.error(
          "AI extraction schema validation failed for section:",
          section.id,
          result.error.issues,
        );
        continue;
      }

      const extracted = result.data;
      const typeMap: Record<string, string> = {
        methods: "method",
        datasets: "dataset",
        baselines: "baseline",
        metrics: "metric",
        results: "result",
        contributions: "contribution",
        limitations: "limitation",
      };

      for (const key of Object.keys(typeMap) as (keyof typeof extracted)[]) {
        const items = extracted[key];
        for (const item of items) {
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

function stripMarkdownFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : text.trim();
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
