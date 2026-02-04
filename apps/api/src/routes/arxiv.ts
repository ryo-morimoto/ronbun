import { Hono } from "hono";
import type { Env } from "../env.ts";
import {
  searchArxivPapersWithMetadata,
  fetchArxivMetadata,
  fetchArxivHtml,
  parseHtmlContent,
} from "@ronbun/arxiv";

const arxiv = new Hono<{ Bindings: Env }>()
  .post("/search", async (c) => {
    try {
      const body = await c.req.json<{ query: string; maxResults?: number }>();
      const results = await searchArxivPapersWithMetadata(body.query, body.maxResults);
      return c.json({ results });
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return c.json({ error: "arXiv search timed out", code: "TIMEOUT" }, 504);
      }
      throw error;
    }
  })
  .get("/:arxivId/preview", async (c) => {
    try {
      const arxivId = c.req.param("arxivId");
      const metadata = await fetchArxivMetadata(arxivId);
      const html = await fetchArxivHtml(arxivId);
      let bodyText: string | null = null;
      if (html) {
        const parsed = parseHtmlContent(html);
        bodyText = parsed.sections.map((s) => s.content).join("\n\n");
        if (bodyText.length > 10000) {
          bodyText = bodyText.slice(0, 10000);
        }
      }
      return c.json({
        arxivId,
        title: metadata.title,
        authors: metadata.authors,
        abstract: metadata.abstract,
        bodyText,
      });
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return c.json({ error: "arXiv request timed out", code: "TIMEOUT" }, 504);
      }
      throw error;
    }
  });

export default arxiv;
