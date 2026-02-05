import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Env } from "./env.ts";
import papers from "./routes/papers.ts";
import extractions from "./routes/extractions.ts";
import arxiv from "./routes/arxiv.ts";
import { createRateLimit } from "./middleware/rate-limit.ts";

const api = new Hono<{ Bindings: Env }>()
  .use(
    "/*",
    createRateLimit({
      keyPrefix: "api-global",
      limit: 180,
      windowMs: 60_000,
    }),
  )
  .route("/papers", papers)
  .route("/extractions", extractions)
  .route("/arxiv", arxiv);

export const app = new Hono<{ Bindings: Env }>()
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/api", api)
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    if (err instanceof ZodError) {
      return c.json({ error: err.errors[0].message, code: "VALIDATION_ERROR" }, 400);
    }
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

export type AppType = typeof app;
