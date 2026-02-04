import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { Env } from "./types.ts";
import { ingestPaper, batchIngest } from "./tools/ingest.ts";
import { searchPapers, searchExtractions } from "./tools/search.ts";
import { getPaper, listPapers, findRelated } from "./tools/papers.ts";
import { handleQueueBatch } from "./queue/consumer.ts";

function createMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: "ronbun",
    version: "0.1.0",
  });

  server.registerTool(
    "ingest_paper",
    {
      title: "Ingest Paper",
      description:
        "Ingest a single arxiv paper by its ID. The paper will be queued for async processing.",
      inputSchema: {
        arxivId: z.string().describe("The arxiv paper ID (e.g. 2401.15884)"),
      },
    },
    async ({ arxivId }) => ingestPaper(env, { arxivId }),
  );

  server.registerTool(
    "batch_ingest",
    {
      title: "Batch Ingest Papers",
      description:
        "Ingest multiple papers at once. Provide either a list of arxiv IDs or a search query.",
      inputSchema: {
        arxivIds: z
          .array(z.string())
          .optional()
          .describe("List of arxiv IDs to ingest"),
        searchQuery: z
          .string()
          .optional()
          .describe("Search query to find and ingest papers from arxiv"),
      },
    },
    async ({ arxivIds, searchQuery }) =>
      batchIngest(env, { arxivIds, searchQuery }),
  );

  server.registerTool(
    "search_papers",
    {
      title: "Search Papers",
      description:
        "Search ingested papers using hybrid semantic + keyword search.",
      inputSchema: {
        query: z
          .string()
          .describe("Search query (keywords or natural language)"),
        category: z
          .string()
          .optional()
          .describe("Filter by arxiv category (e.g. cs.CL)"),
        yearFrom: z.number().optional().describe("Filter from this year"),
        yearTo: z.number().optional().describe("Filter up to this year"),
        limit: z.number().optional().describe("Max results (default 10)"),
      },
    },
    async (args) => searchPapers(env, args),
  );

  server.registerTool(
    "get_paper",
    {
      title: "Get Paper",
      description:
        "Get full paper details: metadata, sections, extractions, citations, related papers.",
      inputSchema: {
        paperId: z.string().describe("Paper ID or arxiv ID"),
      },
    },
    async ({ paperId }) => getPaper(env, { paperId }),
  );

  server.registerTool(
    "list_papers",
    {
      title: "List Papers",
      description: "List ingested papers with filtering and pagination.",
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        year: z.number().optional().describe("Filter by year"),
        status: z
          .enum([
            "queued",
            "metadata",
            "parsed",
            "extracted",
            "ready",
            "failed",
          ])
          .optional()
          .describe("Filter by status"),
        sortBy: z
          .enum(["published_at", "created_at", "title"])
          .optional()
          .describe("Sort field"),
        sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order"),
        cursor: z.string().optional().describe("Pagination cursor"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => listPapers(env, args),
  );

  server.registerTool(
    "find_related",
    {
      title: "Find Related Papers",
      description:
        "Find related papers via citations, shared methods, datasets, or authors.",
      inputSchema: {
        paperId: z.string().describe("Paper ID or arxiv ID"),
        linkTypes: z
          .array(
            z.enum([
              "citation",
              "cited_by",
              "shared_method",
              "shared_dataset",
              "shared_author",
            ]),
          )
          .optional()
          .describe("Filter by relationship types"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => findRelated(env, args),
  );

  server.registerTool(
    "search_extractions",
    {
      title: "Search Extractions",
      description:
        "Search extracted structured knowledge across all papers.",
      inputSchema: {
        query: z.string().describe("Search query"),
        type: z
          .enum([
            "method",
            "dataset",
            "baseline",
            "metric",
            "result",
            "contribution",
            "limitation",
          ])
          .optional()
          .describe("Filter by type"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => searchExtractions(env, args),
  );

  return server;
}

// --- Hono app ---

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok" }));

// MCP endpoint
app.post(
  "/mcp",
  bearerAuth({ verifyToken: (token, c) => token === c.env.API_TOKEN }),
  async (c) => {
    const server = createMcpServer(c.env);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    const body = await c.req.json();

    // Forward the raw request to the transport
    return transport.handleRequest(c.req.raw, body);
  },
);

// Paper status check
app.get(
  "/status/:arxivId",
  bearerAuth({ verifyToken: (token, c) => token === c.env.API_TOKEN }),
  async (c) => {
    const arxivId = c.req.param("arxivId");
    const paper = await c.env.DB.prepare(
      "SELECT id, arxiv_id, title, status, error, created_at, ingested_at FROM papers WHERE arxiv_id = ?",
    )
      .bind(arxivId)
      .first();
    if (!paper) {
      return c.json({ error: "Paper not found" }, 404);
    }
    return c.json(paper);
  },
);

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch, env: Env) => {
    await handleQueueBatch(batch, env);
  },
} satisfies ExportedHandler<Env>;
