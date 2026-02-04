import { env, createExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration, seedTestData, authHeaders } from "./setup.ts";
import { app } from "../src/app.ts";

/** Helper: call the Hono app fetch handler with bindings from miniflare. */
async function fetchApp(input: string | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const ctx = createExecutionContext();
  return app.fetch(req, env, ctx);
}

beforeAll(async () => {
  await applyMigration(env.DB);
  await seedTestData(env.DB);
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
describe("GET /health", () => {
  it("returns 200 with status ok (no auth required)", async () => {
    const res = await fetchApp("http://localhost/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
describe("Authentication", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await fetchApp("http://localhost/api/papers");
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong token is provided", async () => {
    const res = await fetchApp("http://localhost/api/papers", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 when correct token is provided", async () => {
    const res = await fetchApp("http://localhost/api/papers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers
// ---------------------------------------------------------------------------
describe("GET /api/papers", () => {
  it("lists all papers", async () => {
    const res = await fetchApp("http://localhost/api/papers", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ papers: unknown[]; cursor: string | null; hasMore: boolean }>();
    expect(body.papers.length).toBeGreaterThanOrEqual(3);
    expect(body).toHaveProperty("cursor");
    expect(body).toHaveProperty("hasMore");
  });

  it("filters by status", async () => {
    const res = await fetchApp("http://localhost/api/papers?status=ready", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ papers: Array<{ status: string }> }>();
    expect(body.papers.length).toBeGreaterThanOrEqual(2);
    for (const p of body.papers) {
      expect(p.status).toBe("ready");
    }
  });

  it("respects limit parameter", async () => {
    const res = await fetchApp("http://localhost/api/papers?limit=1", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ papers: unknown[]; hasMore: boolean }>();
    expect(body.papers.length).toBe(1);
    expect(body.hasMore).toBe(true);
  });

  it("sorts by published_at asc", async () => {
    const res = await fetchApp(
      "http://localhost/api/papers?sortBy=published_at&sortOrder=asc&status=ready",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      papers: Array<{ arxiv_id: string; published_at: string | null }>;
    }>();
    // Verify ascending order: each paper's published_at <= next
    for (let i = 1; i < body.papers.length; i++) {
      const prev = body.papers[i - 1].published_at ?? "";
      const curr = body.papers[i].published_at ?? "";
      expect(prev <= curr).toBe(true);
    }
  });

  it("returns parsed JSON arrays for authors and categories", async () => {
    const res = await fetchApp("http://localhost/api/papers?status=ready", {
      headers: authHeaders(),
    });
    const body = await res.json<{
      papers: Array<{ arxiv_id: string; authors: string[]; categories: string[] }>;
    }>();
    const paper = body.papers.find((p) => p.arxiv_id === "2401.15884");
    expect(paper).toBeDefined();
    expect(Array.isArray(paper!.authors)).toBe(true);
    expect(paper!.authors).toContain("Shi-Qi Yan");
    expect(Array.isArray(paper!.categories)).toBe(true);
    expect(paper!.categories).toContain("cs.CL");
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id", () => {
  it("returns paper detail by id", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ paper: { id: string } }>();
    expect(body.paper.id).toBe("paper-1");
  });

  it("returns paper detail by arxiv_id", async () => {
    const res = await fetchApp("http://localhost/api/papers/2401.15884", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ paper: { arxiv_id: string } }>();
    expect(body.paper.arxiv_id).toBe("2401.15884");
  });

  it("returns 404 for non-existent paper", async () => {
    const res = await fetchApp("http://localhost/api/papers/does-not-exist", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("includes sections ordered by position", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1", {
      headers: authHeaders(),
    });
    const body = await res.json<{ sections: Array<{ heading: string; position: number }> }>();
    expect(body.sections.length).toBe(2);
    expect(body.sections[0].heading).toBe("Introduction");
    expect(body.sections[0].position).toBe(0);
    expect(body.sections[1].heading).toBe("Methods");
    expect(body.sections[1].position).toBe(1);
  });

  it("includes citations", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1", {
      headers: authHeaders(),
    });
    const body = await res.json<{ citations: Array<{ target_arxiv_id: string }> }>();
    expect(body.citations.length).toBe(1);
    expect(body.citations[0].target_arxiv_id).toBe("2312.10997");
  });

  it("includes citedBy", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-2", {
      headers: authHeaders(),
    });
    const body = await res.json<{ citedBy: Array<{ source_paper_id: string }> }>();
    expect(body.citedBy.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id/status
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id/status", () => {
  it("returns status by id", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; id: string }>();
    expect(body.id).toBe("paper-1");
    expect(body.status).toBe("ready");
  });

  it("returns status by arxiv_id", async () => {
    const res = await fetchApp("http://localhost/api/papers/2401.15884/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ arxiv_id: string; status: string }>();
    expect(body.arxiv_id).toBe("2401.15884");
    expect(body.status).toBe("ready");
  });

  it("returns 404 for non-existent paper", async () => {
    const res = await fetchApp("http://localhost/api/papers/does-not-exist/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns queued status for queued paper", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-3/status", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// GET /api/papers/:id/related
// ---------------------------------------------------------------------------
describe("GET /api/papers/:id/related", () => {
  it("finds related papers via shared entities", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1/related", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ relatedPapers: Array<{ paperId: string }> }>();
    expect(body.relatedPapers.length).toBeGreaterThan(0);
    const ids = body.relatedPapers.map((r) => r.paperId);
    expect(ids).toContain("paper-2");
  });

  it("finds related via citation link type", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-1/related?linkTypes=citation", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ relatedPapers: Array<{ linkType: string }> }>();
    for (const r of body.relatedPapers) {
      expect(r.linkType).toBe("citation");
    }
  });

  it("filters by shared_method link type", async () => {
    const res = await fetchApp(
      "http://localhost/api/papers/paper-1/related?linkTypes=shared_method",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ relatedPapers: Array<{ linkType: string; paperId: string }> }>();
    for (const r of body.relatedPapers) {
      expect(r.linkType).toBe("shared_method");
    }
  });

  it("returns empty array for paper with no relations", async () => {
    const res = await fetchApp("http://localhost/api/papers/paper-3/related", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ relatedPapers: unknown[] }>();
    expect(body.relatedPapers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/papers/ingest
// ---------------------------------------------------------------------------
describe("POST /api/papers/ingest", () => {
  it("queues a new paper for ingestion", async () => {
    const res = await fetchApp("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ arxivId: "2406.12345" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; paperId: string }>();
    expect(body.status).toBe("queued");
    expect(body.paperId).toBeDefined();

    // Verify the paper was actually inserted
    const check = await env.DB.prepare("SELECT * FROM papers WHERE arxiv_id = ?")
      .bind("2406.12345")
      .first();
    expect(check).not.toBeNull();
    expect(check!.status).toBe("queued");
  });

  it("returns existing paper on duplicate ingest", async () => {
    const res = await fetchApp("http://localhost/api/papers/ingest", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ arxivId: "2401.15884" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; paperId: string; message?: string }>();
    expect(body.paperId).toBe("paper-1");
    expect(body.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// POST /api/papers/search
// ---------------------------------------------------------------------------
describe("POST /api/papers/search", () => {
  it("searches papers via FTS (degraded mode without Vectorize)", async () => {
    const res = await fetchApp("http://localhost/api/papers/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "retrieval augmented generation" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ papers: Array<{ id: string; title: string }> }>();
    expect(body.papers.length).toBeGreaterThan(0);
    const titles = body.papers.map((p) => p.title);
    expect(titles.some((t) => t.includes("Retrieval"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/extractions/search
// ---------------------------------------------------------------------------
describe("POST /api/extractions/search", () => {
  it("searches extractions via FTS", async () => {
    const res = await fetchApp("http://localhost/api/extractions/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "CRAG" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ extractions: Array<{ name: string }> }>();
    expect(body.extractions.length).toBeGreaterThan(0);
    expect(body.extractions[0].name).toBe("CRAG");
  });

  it("filters extractions by type", async () => {
    const res = await fetchApp("http://localhost/api/extractions/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "PopQA", type: "dataset" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ extractions: Array<{ type: string; name: string }> }>();
    expect(body.extractions.length).toBeGreaterThan(0);
    for (const e of body.extractions) {
      expect(e.type).toBe("dataset");
    }
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe("Error handling", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await fetchApp("http://localhost/api/unknown-route", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
