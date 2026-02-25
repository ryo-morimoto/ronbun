import { Hono } from "hono";
import { searchExtractions } from "@ronbun/api";
import { createRateLimit } from "../middleware/rate-limit";
import { createRonbunContext } from "../context";

const extractions = new Hono<{ Bindings: Env }>().post(
  "/search",
  createRateLimit({
    keyPrefix: "extractions-search",
    limit: 30,
    windowMs: 60_000,
  }),
  async (c) => {
    const body = await c.req.json();
    const ctx = createRonbunContext(c.env);
    const result = await searchExtractions(ctx, body);
    return c.json(result);
  },
);

export default extractions;
