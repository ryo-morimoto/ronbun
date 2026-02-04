import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Env } from "./env.ts";
import papers from "./routes/papers.ts";
import extractions from "./routes/extractions.ts";
import arxiv from "./routes/arxiv.ts";

const api = new Hono<{ Bindings: Env }>()
  .use("/*", async (c, next) => {
    const auth = bearerAuth({
      verifyToken: (token) => token === c.env.API_TOKEN,
    });
    return auth(c, next);
  })
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
      return c.json(
        { error: err.errors[0].message, code: "VALIDATION_ERROR" },
        400,
      );
    }
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

export type AppType = typeof app;
