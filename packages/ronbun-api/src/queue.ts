import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { queueMessageSchema } from "@ronbun/schemas";
import {
  fetchArxivHtml,
  fetchArxivNativeHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
  extractPdfText,
  generateId,
} from "@ronbun/arxiv";
import {
  markPaperReady,
  insertSection,
  insertCitation,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
} from "@ronbun/database";
import { findPaperIdByArxivId } from "@ronbun/database";
import { storeHtml, storePdf } from "@ronbun/storage";

export async function processContent(ctx: RonbunContext, message: QueueMessage): Promise<void> {
  const { paperId, arxivId } = queueMessageSchema.parse(message);

  await deleteSectionsByPaperId(ctx.db, paperId);
  await deleteCitationsBySourcePaperId(ctx.db, paperId);

  let parsedContent;

  // Tier 1: ar5iv HTML (best quality when available, ~77% of historical corpus)
  // NOTE: ar5iv is NOT a live service — it's a static dataset updated periodically.
  // As of 2026-04, sources cover up to end of February 2026.
  // Recent papers will miss here and fall through to Tier 2/3.
  const htmlContent = await fetchArxivHtml(arxivId);
  if (htmlContent) {
    await storeHtml(ctx.storage, arxivId, htmlContent);
    parsedContent = parseHtmlContent(htmlContent);
  }

  // Tier 2: arXiv native HTML (experimental, post-Dec 2023 papers)
  // This is the primary path for recent papers not yet in ar5iv.
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
