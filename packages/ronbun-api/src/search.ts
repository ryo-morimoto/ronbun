import type { RonbunContext } from "./context.ts";
import type { PaperRow } from "@ronbun/types";
import { searchPapersInput, searchExtractionsInput } from "@ronbun/schemas";
import {
  searchPapersFts,
  searchSectionsFts,
  fetchPapersByIds,
  searchExtractionsFts,
} from "@ronbun/database";
import { semanticSearch } from "@ronbun/vector";

export type SearchResult = {
  id: string;
  arxivId: string;
  title: string;
  authors: string;
  abstract: string;
  categories: string;
  publishedAt: string;
  score: number;
};

export type ExtractionSearchResult = {
  id: string;
  paperId: string;
  type: string;
  name: string;
  detail: string | null;
  paperTitle: string;
  arxivId: string;
};

function mergeWithRRF(
  ftsResults: Map<string, number>,
  vectorResults: Map<string, number>,
  k = 60,
): Map<string, number> {
  const combined = new Map<string, number>();
  for (const [id, rank] of ftsResults.entries()) {
    combined.set(id, (combined.get(id) || 0) + 1 / (k + rank));
  }
  for (const [id, rank] of vectorResults.entries()) {
    combined.set(id, (combined.get(id) || 0) + 1 / (k + rank));
  }
  return combined;
}

export async function searchPapers(
  ctx: RonbunContext,
  input: unknown,
): Promise<{ papers: SearchResult[] }> {
  const validated = searchPapersInput.parse(input);
  const { query, category, yearFrom, yearTo, limit } = validated;

  // 1. FTS5 keyword search on papers
  const papersFtsResults = await searchPapersFts(ctx.db, query, limit * 2);
  const ftsScores = new Map<string, number>();
  const paperCache = new Map<string, PaperRow>();

  for (const [idx, row] of papersFtsResults.entries()) {
    ftsScores.set(row.id, idx);
    paperCache.set(row.id, {
      id: row.id,
      arxiv_id: row.arxiv_id,
      title: row.title,
      authors: row.authors,
      abstract: row.abstract,
      categories: row.categories,
      published_at: row.published_at,
      updated_at: null,
      status: "ready",
      error: null,
      created_at: "",
      ingested_at: null,
    });
  }

  // 2. FTS5 on sections
  const sectionsFtsResults = await searchSectionsFts(ctx.db, query, limit * 2);
  for (const [idx, row] of sectionsFtsResults.entries()) {
    if (!ftsScores.has(row.id)) {
      ftsScores.set(row.id, papersFtsResults.length + idx);
      paperCache.set(row.id, {
        id: row.id,
        arxiv_id: row.arxiv_id,
        title: row.title,
        authors: row.authors,
        abstract: row.abstract,
        categories: row.categories,
        published_at: row.published_at,
        updated_at: null,
        status: "ready",
        error: null,
        created_at: "",
        ingested_at: null,
      });
    }
  }

  // 3. Semantic search
  const vectorScores = await semanticSearch(ctx.vectorIndex, ctx.ai, query, limit * 2);

  // 4. RRF merge
  const rrfScores = mergeWithRRF(ftsScores, vectorScores);

  // 5. Fetch uncached papers
  const uncachedIds = Array.from(rrfScores.keys()).filter((id) => !paperCache.has(id));
  if (uncachedIds.length > 0) {
    const fetched = await fetchPapersByIds(ctx.db, uncachedIds);
    for (const row of fetched) {
      paperCache.set(row.id, row);
    }
  }

  // 6. Build results
  const results: SearchResult[] = [];
  const sorted = Array.from(rrfScores.entries()).sort((a, b) => b[1] - a[1]);

  for (const [paperId, score] of sorted) {
    const paper = paperCache.get(paperId);
    if (!paper) continue;
    if (category && !paper.categories?.includes(category)) continue;
    if (yearFrom || yearTo) {
      const year = paper.published_at ? new Date(paper.published_at).getFullYear() : null;
      if (!year) continue;
      if (yearFrom && year < yearFrom) continue;
      if (yearTo && year > yearTo) continue;
    }
    results.push({
      id: paper.id,
      arxivId: paper.arxiv_id,
      title: paper.title || "",
      authors: paper.authors || "",
      abstract: paper.abstract || "",
      categories: paper.categories || "",
      publishedAt: paper.published_at || "",
      score,
    });
    if (results.length >= limit) break;
  }

  return { papers: results };
}

export async function searchExtractions(
  ctx: RonbunContext,
  input: unknown,
): Promise<{ extractions: ExtractionSearchResult[] }> {
  const validated = searchExtractionsInput.parse(input);
  const { query, type, limit } = validated;

  const searchResults = await searchExtractionsFts(ctx.db, query, type || null, limit);

  const results: ExtractionSearchResult[] = searchResults.map((row) => ({
    id: row.id,
    paperId: row.paper_id,
    type: row.type,
    name: row.name,
    detail: row.detail,
    paperTitle: row.paper_title,
    arxivId: row.arxiv_id,
  }));

  return { extractions: results };
}
