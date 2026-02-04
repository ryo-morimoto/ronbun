import type { Env, PaperRow } from "../types.ts";
import { searchPapersInput, searchExtractionsInput } from "../schemas.ts";

type SearchResult = {
  id: string;
  arxivId: string;
  title: string;
  authors: string;
  abstract: string;
  categories: string;
  publishedAt: string;
  score: number;
};

type ExtractionSearchResult = {
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

export async function searchPapers(env: Env, input: unknown) {
  const validated = searchPapersInput.parse(input);
  const { query, category, yearFrom, yearTo, limit } = validated;

  type FtsRow = {
    id: string;
    arxiv_id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
  };

  // 1. FTS5 keyword search on papers
  const papersFtsResults = await env.DB.prepare(
    `SELECT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
     FROM papers_fts f JOIN papers p ON p.rowid = f.rowid
     WHERE papers_fts MATCH ? AND p.status = 'ready'
     ORDER BY rank LIMIT ?`,
  )
    .bind(query, limit * 2)
    .all<FtsRow>();

  const ftsScores = new Map<string, number>();
  const paperCache = new Map<string, PaperRow>();

  for (const [idx, row] of papersFtsResults.results.entries()) {
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
  const sectionsFtsResults = await env.DB.prepare(
    `SELECT DISTINCT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
     FROM sections_fts f JOIN sections s ON s.rowid = f.rowid
     JOIN papers p ON p.id = s.paper_id
     WHERE sections_fts MATCH ? AND p.status = 'ready' LIMIT ?`,
  )
    .bind(query, limit * 2)
    .all<FtsRow>();

  for (const [idx, row] of sectionsFtsResults.results.entries()) {
    if (!ftsScores.has(row.id)) {
      ftsScores.set(row.id, papersFtsResults.results.length + idx);
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
  const vectorScores = new Map<string, number>();

  try {
    const embedResponse = await env.AI.run("@cf/baai/bge-large-en-v1.5", {
      text: [query],
    });

    const embedding = (embedResponse as { data: number[][] }).data[0];

    const vectorResults = await env.VECTOR_INDEX.query(embedding, {
      topK: limit * 2,
      returnMetadata: "all",
    });

    if (vectorResults.matches) {
      for (const [idx, match] of vectorResults.matches.entries()) {
        const pid = (match.metadata?.paperId as string) || match.id;
        if (!vectorScores.has(pid)) {
          vectorScores.set(pid, idx);
        }
      }
    }
  } catch (error) {
    console.error("Semantic search failed:", error);
  }

  // 4. RRF merge
  const rrfScores = mergeWithRRF(ftsScores, vectorScores);

  // 5. Fetch uncached papers
  const uncachedIds = Array.from(rrfScores.keys()).filter(
    (id) => !paperCache.has(id),
  );

  if (uncachedIds.length > 0) {
    const placeholders = uncachedIds.map(() => "?").join(",");
    const fetchResults = await env.DB.prepare(
      `SELECT * FROM papers WHERE id IN (${placeholders}) AND status = 'ready'`,
    )
      .bind(...uncachedIds)
      .all<PaperRow>();

    for (const row of fetchResults.results) {
      paperCache.set(row.id, row);
    }
  }

  // 6. Build results
  const results: SearchResult[] = [];
  const sorted = Array.from(rrfScores.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  for (const [paperId, score] of sorted) {
    const paper = paperCache.get(paperId);
    if (!paper) continue;

    if (category && !paper.categories?.includes(category)) continue;

    if (yearFrom || yearTo) {
      const year = paper.published_at
        ? new Date(paper.published_at).getFullYear()
        : null;
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

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ papers: results }, null, 2),
      },
    ],
  };
}

export async function searchExtractions(env: Env, input: unknown) {
  const validated = searchExtractionsInput.parse(input);
  const { query, type, limit } = validated;

  const searchResults = await env.DB.prepare(
    `SELECT e.id, e.paper_id, e.type, e.name, e.detail, p.title as paper_title, p.arxiv_id
     FROM extractions_fts f JOIN extractions e ON e.rowid = f.rowid
     JOIN papers p ON p.id = e.paper_id
     WHERE extractions_fts MATCH ?
     AND (? IS NULL OR e.type = ?)
     ORDER BY rank LIMIT ?`,
  )
    .bind(query, type || null, type || null, limit)
    .all<{
      id: string;
      paper_id: string;
      type: string;
      name: string;
      detail: string | null;
      paper_title: string;
      arxiv_id: string;
    }>();

  const results: ExtractionSearchResult[] = searchResults.results.map(
    (row) => ({
      id: row.id,
      paperId: row.paper_id,
      type: row.type,
      name: row.name,
      detail: row.detail,
      paperTitle: row.paper_title,
      arxivId: row.arxiv_id,
    }),
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ extractions: results }, null, 2),
      },
    ],
  };
}
