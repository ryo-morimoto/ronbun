import type { RonbunContext } from "./context.ts";
import type { ParsedPaper, SectionRow, CitationRow } from "@ronbun/types";
import { getPaperInput, listPapersInput, findRelatedInput } from "@ronbun/schemas";
import {
  getPaperById,
  listPapers as dbListPapers,
  getSectionsByPaperId,
  getCitationsBySource,
  getCitedBy,
  findSharedEntities,
} from "@ronbun/database";

export type PaperDetail = {
  paper: ParsedPaper;
  sections: SectionRow[];
  citations: CitationRow[];
  citedBy: Array<CitationRow & { source_title: string; source_arxiv_id: string }>;
};

export async function getPaper(ctx: RonbunContext, input: unknown): Promise<PaperDetail | null> {
  const validated = getPaperInput.parse(input);
  const paperResult = await getPaperById(ctx.db, validated.paperId);

  if (!paperResult) return null;

  const paper = {
    ...paperResult,
    authors: paperResult.authors ? JSON.parse(paperResult.authors) : [],
    categories: paperResult.categories ? JSON.parse(paperResult.categories) : [],
  };

  const sections = await getSectionsByPaperId(ctx.db, paperResult.id);
  const citations = await getCitationsBySource(ctx.db, paperResult.id);
  const citedBy = await getCitedBy(ctx.db, paperResult.id);

  return { paper, sections, citations, citedBy };
}

export type PaperListResult = {
  papers: ParsedPaper[];
  cursor: string | null;
  hasMore: boolean;
};

export async function listPapers(ctx: RonbunContext, input: unknown): Promise<PaperListResult> {
  const validated = listPapersInput.parse(input);
  const { category, year, status, sortBy, sortOrder, cursor, limit } = validated;

  const result = await dbListPapers(ctx.db, {
    category,
    year,
    status,
    sortBy,
    sortOrder,
    cursor,
    limit,
  });

  const parsedPapers = result.papers.map((p) => ({
    ...p,
    authors: p.authors ? JSON.parse(p.authors) : [],
    categories: p.categories ? JSON.parse(p.categories) : [],
  }));

  const nextCursor = result.papers.length > 0 ? result.papers[result.papers.length - 1].id : null;

  return {
    papers: parsedPapers,
    cursor: nextCursor,
    hasMore: result.hasMore,
  };
}

export type RelatedPaper = {
  paperId: string;
  title: string | null;
  arxivId: string;
  linkType: string;
  linkDetail: string | null;
};

export async function findRelated(
  ctx: RonbunContext,
  input: unknown,
): Promise<{ relatedPapers: RelatedPaper[] }> {
  const validated = findRelatedInput.parse(input);
  const { paperId, linkTypes, limit } = validated;

  const paperExists = await getPaperById(ctx.db, paperId);
  if (!paperExists) {
    return { relatedPapers: [] };
  }

  const actualPaperId = paperExists.id;
  const types = linkTypes || ["citation", "cited_by", "shared_author"];

  const relatedPapers: RelatedPaper[] = [];
  const seen = new Set<string>();

  if (types.includes("citation")) {
    const citations = await getCitationsBySource(ctx.db, actualPaperId);
    for (const c of citations) {
      if (c.target_paper_id && !seen.has(c.target_paper_id)) {
        seen.add(c.target_paper_id);
        const targetPaper = await getPaperById(ctx.db, c.target_paper_id);
        relatedPapers.push({
          paperId: c.target_paper_id,
          title: targetPaper?.title ?? c.target_title,
          arxivId: targetPaper?.arxiv_id ?? c.target_arxiv_id ?? "",
          linkType: "citation",
          linkDetail: null,
        });
      }
    }
  }

  if (types.includes("cited_by")) {
    const citedBy = await getCitedBy(ctx.db, actualPaperId);
    for (const c of citedBy) {
      const key = c.source_paper_id;
      if (!seen.has(key)) {
        seen.add(key);
        relatedPapers.push({
          paperId: key,
          title: c.source_title,
          arxivId: c.source_arxiv_id,
          linkType: "cited_by",
          linkDetail: null,
        });
      }
    }
  }

  if (types.includes("shared_author")) {
    const shared = await findSharedEntities(ctx.db, actualPaperId, "author");
    for (const row of shared) {
      if (!seen.has(row.paper_id)) {
        seen.add(row.paper_id);
        relatedPapers.push({
          paperId: row.paper_id,
          title: row.title,
          arxivId: row.arxiv_id,
          linkType: "shared_author",
          linkDetail: row.entity_name,
        });
      }
    }
  }

  return { relatedPapers: relatedPapers.slice(0, limit) };
}
