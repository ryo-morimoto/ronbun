import { Hono } from "hono";
import { searchPapers, getPaper, listPapers, findRelated } from "@ronbun/api";
import { createRateLimit } from "../middleware/rate-limit";
import { createRonbunContext } from "../context";

const papers = new Hono<{ Bindings: Env }>()
  .post(
    "/search",
    createRateLimit({
      keyPrefix: "papers-search",
      limit: 40,
      windowMs: 60_000,
    }),
    async (c) => {
      const body = await c.req.json();
      const ctx = createRonbunContext(c.env);
      const result = await searchPapers(ctx, body);
      return c.json(result);
    },
  )
  .get("/", async (c) => {
    const ctx = createRonbunContext(c.env);
    const query = c.req.query();
    const result = await listPapers(ctx, {
      category: query.category,
      year: query.year ? Number(query.year) : undefined,
      status: query.status,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return c.json(result);
  })
  .get("/:id", async (c) => {
    const ctx = createRonbunContext(c.env);
    const id = c.req.param("id");
    const result = await getPaper(ctx, { paperId: id });
    if (!result) return c.json({ error: "Paper not found" }, 404);
    return c.json(result);
  })
  .get("/:id/related", async (c) => {
    const ctx = createRonbunContext(c.env);
    const id = c.req.param("id");
    const query = c.req.query();
    const result = await findRelated(ctx, {
      paperId: id,
      linkTypes: query.linkTypes ? query.linkTypes.split(",") : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return c.json(result);
  })
  .get("/:id/status", async (c) => {
    const id = c.req.param("id");
    const paper = await c.env.DB.prepare(
      "SELECT id, arxiv_id, title, status, error, created_at, ingested_at FROM papers WHERE arxiv_id = ? OR id = ?",
    )
      .bind(id, id)
      .first();
    if (!paper) return c.json({ error: "Paper not found" }, 404);
    return c.json(paper);
  });

export default papers;
