import type { Env, PaperRow, SectionRow, ExtractionRow, CitationRow } from "../types.ts";
import { getPaperInput, listPapersInput, findRelatedInput } from "../schemas.ts";

export async function getPaper(env: Env, input: unknown) {
  try {
    const validated = getPaperInput.parse(input);
    const paperId = validated.paperId;

    // Fetch paper by id or arxiv_id
    const paperResult = await env.DB.prepare(
      "SELECT * FROM papers WHERE id = ? OR arxiv_id = ?"
    ).bind(paperId, paperId).first<PaperRow>();

    if (!paperResult) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: `Paper not found: ${paperId}` })
        }]
      };
    }

    // Parse JSON fields
    const paper = {
      ...paperResult,
      authors: paperResult.authors ? JSON.parse(paperResult.authors) : [],
      categories: paperResult.categories ? JSON.parse(paperResult.categories) : []
    };

    // Fetch sections
    const sectionsResult = await env.DB.prepare(
      "SELECT * FROM sections WHERE paper_id = ? ORDER BY position"
    ).bind(paperResult.id).all<SectionRow>();
    const sections = sectionsResult.results || [];

    // Fetch extractions
    const extractionsResult = await env.DB.prepare(
      "SELECT * FROM extractions WHERE paper_id = ? ORDER BY type, name"
    ).bind(paperResult.id).all<ExtractionRow>();
    const extractions = extractionsResult.results || [];

    // Fetch citations (outgoing)
    const citationsResult = await env.DB.prepare(
      "SELECT * FROM citations WHERE source_paper_id = ?"
    ).bind(paperResult.id).all<CitationRow>();
    const citations = citationsResult.results || [];

    // Fetch cited-by (incoming)
    const citedByResult = await env.DB.prepare(`
      SELECT c.*, p.title as source_title, p.arxiv_id as source_arxiv_id
      FROM citations c
      JOIN papers p ON p.id = c.source_paper_id
      WHERE c.target_paper_id = ?
    `).bind(paperResult.id).all();
    const citedBy = citedByResult.results || [];

    // Fetch related papers via entity_links
    const relatedResult = await env.DB.prepare(`
      SELECT DISTINCT el2.paper_id, p.title, p.arxiv_id, el.entity_type, el.entity_name
      FROM entity_links el
      JOIN entity_links el2 ON el.entity_type = el2.entity_type
        AND el.entity_name = el2.entity_name
        AND el.paper_id != el2.paper_id
      JOIN papers p ON p.id = el2.paper_id
      WHERE el.paper_id = ?
      LIMIT 20
    `).bind(paperResult.id).all();
    const relatedPapers = relatedResult.results || [];

    const result = {
      paper,
      sections,
      extractions,
      citations,
      citedBy,
      relatedPapers
    };

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }]
    };
  }
}

export async function listPapers(env: Env, input: unknown) {
  try {
    const validated = listPapersInput.parse(input);
    const { category, year, status, sortBy, sortOrder, cursor, limit } = validated;

    // Build dynamic query
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      conditions.push(`categories LIKE '%"' || ? || '"%'`);
      params.push(category);
    }

    if (year) {
      conditions.push(`published_at LIKE ? || '%'`);
      params.push(year.toString());
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    // Cursor-based pagination
    if (cursor) {
      if (sortOrder === "desc") {
        conditions.push(`(${sortBy} < (SELECT ${sortBy} FROM papers WHERE id = ?) OR (${sortBy} = (SELECT ${sortBy} FROM papers WHERE id = ?) AND id < ?))`);
        params.push(cursor, cursor, cursor);
      } else {
        conditions.push(`(${sortBy} > (SELECT ${sortBy} FROM papers WHERE id = ?) OR (${sortBy} = (SELECT ${sortBy} FROM papers WHERE id = ?) AND id > ?))`);
        params.push(cursor, cursor, cursor);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT * FROM papers
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder}
      LIMIT ?
    `;

    params.push(limit + 1); // Fetch one extra to determine hasMore

    const result = await env.DB.prepare(query).bind(...params).all<PaperRow>();
    const papers = result.results || [];

    const hasMore = papers.length > limit;
    if (hasMore) {
      papers.pop(); // Remove the extra item
    }

    const nextCursor = papers.length > 0 ? papers[papers.length - 1].id : null;

    // Parse JSON fields for each paper
    const parsedPapers = papers.map(p => ({
      ...p,
      authors: p.authors ? JSON.parse(p.authors) : [],
      categories: p.categories ? JSON.parse(p.categories) : []
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          papers: parsedPapers,
          cursor: nextCursor,
          hasMore
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }]
    };
  }
}

export async function findRelated(env: Env, input: unknown) {
  try {
    const validated = findRelatedInput.parse(input);
    const { paperId, linkTypes, limit } = validated;

    // Check paper exists
    const paperExists = await env.DB.prepare(
      "SELECT id FROM papers WHERE id = ? OR arxiv_id = ?"
    ).bind(paperId, paperId).first();

    if (!paperExists) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: `Paper not found: ${paperId}` })
        }]
      };
    }

    const actualPaperId = paperExists.id as string;
    const types = linkTypes || ["citation", "cited_by", "shared_method", "shared_dataset", "shared_author"];

    type RelatedPaper = {
      paperId: string;
      title: string | null;
      arxivId: string;
      linkType: string;
      linkDetail: string | null;
    };

    const relatedPapers: RelatedPaper[] = [];
    const seen = new Set<string>();

    // Citation links
    if (types.includes("citation")) {
      const citationsResult = await env.DB.prepare(`
        SELECT c.target_paper_id, p.title, p.arxiv_id
        FROM citations c
        LEFT JOIN papers p ON p.id = c.target_paper_id
        WHERE c.source_paper_id = ? AND c.target_paper_id IS NOT NULL
      `).bind(actualPaperId).all();

      for (const row of citationsResult.results || []) {
        const key = (row.target_paper_id as string);
        if (!seen.has(key)) {
          seen.add(key);
          relatedPapers.push({
            paperId: key,
            title: row.title as string | null,
            arxivId: row.arxiv_id as string,
            linkType: "citation",
            linkDetail: null
          });
        }
      }
    }

    // Cited-by links
    if (types.includes("cited_by")) {
      const citedByResult = await env.DB.prepare(`
        SELECT c.source_paper_id, p.title, p.arxiv_id
        FROM citations c
        JOIN papers p ON p.id = c.source_paper_id
        WHERE c.target_paper_id = ?
      `).bind(actualPaperId).all();

      for (const row of citedByResult.results || []) {
        const key = (row.source_paper_id as string);
        if (!seen.has(key)) {
          seen.add(key);
          relatedPapers.push({
            paperId: key,
            title: row.title as string | null,
            arxivId: row.arxiv_id as string,
            linkType: "cited_by",
            linkDetail: null
          });
        }
      }
    }

    // Shared entity links
    const entityTypes: Array<"method" | "dataset" | "author"> = [];
    if (types.includes("shared_method")) entityTypes.push("method");
    if (types.includes("shared_dataset")) entityTypes.push("dataset");
    if (types.includes("shared_author")) entityTypes.push("author");

    for (const entityType of entityTypes) {
      const sharedResult = await env.DB.prepare(`
        SELECT DISTINCT el2.paper_id, p.title, p.arxiv_id, el.entity_name
        FROM entity_links el
        JOIN entity_links el2 ON el.entity_type = el2.entity_type
          AND el.entity_name = el2.entity_name
          AND el.paper_id != el2.paper_id
        JOIN papers p ON p.id = el2.paper_id
        WHERE el.paper_id = ? AND el.entity_type = ?
      `).bind(actualPaperId, entityType).all();

      for (const row of sharedResult.results || []) {
        const key = (row.paper_id as string);
        if (!seen.has(key)) {
          seen.add(key);
          relatedPapers.push({
            paperId: key,
            title: row.title as string | null,
            arxivId: row.arxiv_id as string,
            linkType: `shared_${entityType}`,
            linkDetail: row.entity_name as string
          });
        }
      }
    }

    // Apply limit
    const limitedPapers = relatedPapers.slice(0, limit);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          relatedPapers: limitedPapers
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }]
    };
  }
}
