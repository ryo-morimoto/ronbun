import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import papers from "./papers";
import extractions from "./extractions";
import arxiv from "./arxiv";
import { createRateLimit } from "../middleware/rate-limit";

const api = new Hono<{ Bindings: Env }>()
  .use(
    "/*",
    createRateLimit({
      keyPrefix: "api-global",
      limit: 180,
      windowMs: 60_000,
    }),
  )
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/papers", papers)
  .route("/extractions", extractions)
  .route("/arxiv", arxiv);

const app = new Hono<{ Bindings: Env }>().route("/api", api).onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof ZodError) {
    return c.json({ error: err.errors[0].message, code: "VALIDATION_ERROR" }, 400);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export type ApiAppType = typeof app;
export type { ApiAppType as AppType };

export async function handleApiRequest(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (!pathname.startsWith("/api/")) {
    return null;
  }

  return app.fetch(request, env);
}
