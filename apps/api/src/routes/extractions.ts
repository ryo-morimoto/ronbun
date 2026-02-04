import { Hono } from "hono";
import type { Env } from "../env.ts";
import type { RonbunContext } from "@ronbun/api";
import { searchExtractions } from "@ronbun/api";

function createContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}

const extractions = new Hono<{ Bindings: Env }>().post(
  "/search",
  async (c) => {
    const body = await c.req.json();
    const ctx = createContext(c.env);
    const result = await searchExtractions(ctx, body);
    return c.json(result);
  },
);

export default extractions;
