import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration, seedTestData, authHeaders } from "./setup.ts";
import { handleApiRequest } from "../src/server/api/router";

/** Helper: call the API handler with bindings from miniflare. */
async function fetchApi(input: string | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const res = await handleApiRequest(req, env as unknown as Env);
  if (!res) {
    return new Response("Not Found", { status: 404 });
  }
  return res;
}

beforeAll(async () => {
  await applyMigration(env.DB);
  await seedTestData(env.DB);
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
describe("GET /api/health", () => {
  it("returns 200 with status ok (no auth required)", async () => {
    const res = await fetchApi("http://localhost/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body).toEqual({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
describe("Authentication", () => {
  it("allows unauthenticated access to read endpoints", async () => {
    const res = await fetchApi("http://localhost/api/papers");
    expect(res.status).toBe(200);
  });

  it("returns 401 when no token is provided for write endpoints", async () => {
    const res = await fetchApi("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arxivId: "2401.15884" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong token is provided for write endpoints", async () => {
    const res = await fetchApi("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ arxivId: "2401.15884" }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers
// ---------------------------------------------------------------------------
describe("GET /api/papers", () => {
  it("lists all papers", async () => {
    const res = await fetchApi("http://localhost/api/papers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: unknown[] };
    expect(body.papers).toBeDefined();
    expect(body.papers.length).toBeGreaterThan(0);
  });

  it("filters by status", async () => {
    const res = await fetchApi("http://localhost/api/papers?status=ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: Array<{ status: string }> };
    expect(body.papers.every((p) => p.status === "ready")).toBe(true);
  });

  it("respects limit parameter", async () => {
    const res = await fetchApi("http://localhost/api/papers?limit=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: unknown[] };
    expect(body.papers.length).toBeLessThanOrEqual(1);
  });

  it("sorts by published_at asc", async () => {
    const res = await fetchApi("http://localhost/api/papers?sortBy=published_at&sortOrder=asc");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: Array<{ published_at: string }> };
    if (body.papers.length >= 2) {
      const dates = body.papers.map((p) => new Date(p.published_at).getTime());
      expect(dates[0]).toBeLessThanOrEqual(dates[1]);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id", () => {
  it("returns paper detail by id", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paper: { id: string; arxiv_id: string } };
    expect(body.paper.id).toBe("paper-1");
    expect(body.paper.arxiv_id).toBe("2401.15884");
  });

  it("returns paper detail by arxiv_id", async () => {
    const res = await fetchApi("http://localhost/api/papers/2401.15884");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paper: { arxiv_id: string } };
    expect(body.paper.arxiv_id).toBe("2401.15884");
  });

  it("returns 404 for non-existent paper", async () => {
    const res = await fetchApi("http://localhost/api/papers/non-existent");
    expect(res.status).toBe(404);
  });

  it("includes sections ordered by position", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: unknown[] };
    expect(body.sections).toBeDefined();
    expect(body.sections.length).toBeGreaterThan(0);
  });

  it("includes citations", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citations: unknown[] };
    expect(body.citations).toBeDefined();
  });

  it("includes citedBy", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citedBy: unknown[] };
    expect(body.citedBy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id/status
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id/status", () => {
  it("returns status by id", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-1/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });

  it("returns status by arxiv_id", async () => {
    const res = await fetchApi("http://localhost/api/papers/2401.15884/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { arxiv_id: string };
    expect(body.arxiv_id).toBe("2401.15884");
  });

  it("returns 404 for non-existent paper", async () => {
    const res = await fetchApi("http://localhost/api/papers/non-existent/status");
    expect(res.status).toBe(404);
  });

  it("returns queued status for queued paper", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-3/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id/related
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id/related", () => {
  it("finds related papers via shared entities", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-1/related");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relatedPapers: unknown[] };
    expect(body.relatedPapers).toBeDefined();
  });

  it("filters by shared_method link type", async () => {
    const res = await fetchApi(
      "http://localhost/api/papers/paper-1/related?linkTypes=shared_method",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relatedPapers: unknown[] };
    expect(body.relatedPapers).toBeDefined();
  });

  it("returns empty array for paper with no relations", async () => {
    const res = await fetchApi("http://localhost/api/papers/paper-3/related");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relatedPapers: unknown[] };
    expect(body.relatedPapers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/papers/ingest
// ---------------------------------------------------------------------------
describe("POST /api/papers/ingest", () => {
  it("queues a new paper for ingestion", async () => {
    const res = await fetchApi("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ arxivId: "2402.00001" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paperId: string };
    expect(body.paperId).toBeDefined();
  });

  it("returns existing paper on duplicate ingest", async () => {
    const res = await fetchApi("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ arxivId: "2401.15884" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Paper already exists");
  });
});

// ---------------------------------------------------------------------------
// POST /api/papers/search
// ---------------------------------------------------------------------------
describe("POST /api/papers/search", () => {
  it("searches papers via FTS (degraded mode without Vectorize)", async () => {
    const res = await fetchApi("http://localhost/api/papers/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "CRAG retrieval" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { papers: unknown[] };
    expect(body.papers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/extractions/search
// ---------------------------------------------------------------------------
describe("POST /api/extractions/search", () => {
  it("searches extractions via FTS", async () => {
    const res = await fetchApi("http://localhost/api/extractions/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "CRAG" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { extractions: unknown[] };
    expect(body.extractions).toBeDefined();
  });

  it("filters extractions by type", async () => {
    const res = await fetchApi("http://localhost/api/extractions/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "method", type: "method" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { extractions: unknown[] };
    expect(body.extractions).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe("Error handling", () => {
  it("returns 404 for unknown API routes", async () => {
    const res = await fetchApi("http://localhost/api/unknown-route");
    expect(res.status).toBe(404);
  });
});
