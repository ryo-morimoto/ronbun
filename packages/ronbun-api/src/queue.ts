import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { queueMessageSchema } from "@ronbun/schemas";
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
  markPaperReady,
  insertSection,
  insertEntityLink,
  insertCitation,
  findPaperIdByArxivId,
  deleteAuthorLinksByPaperId,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
} from "@ronbun/database";
import { storeHtml, storePdf } from "@ronbun/storage";
import { upsertPaperEmbedding } from "@ronbun/vector";

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

  // Abstract embedding for semantic search
  if (metadata.abstract) {
    await upsertPaperEmbedding(ctx.vectorIndex, ctx.ai, paperId, metadata.abstract);
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

  await markPaperReady(ctx.db, paperId);
}
