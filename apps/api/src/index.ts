import { bearerAuth } from "hono/bearer-auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Env } from "./env.ts";
import type { RonbunContext } from "@ronbun/api";
import {
  ingestPaper,
  batchIngest,
  searchPapers,
  searchExtractions,
  getPaper,
  listPapers,
  findRelated,
  processQueueMessage,
} from "@ronbun/api";
import type { QueueMessage } from "@ronbun/types";
import { handleScheduled } from "./cron.ts";
import { app } from "./app.ts";

export type { AppType } from "./app.ts";

function createContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}

function mcpResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function createMcpServer(env: Env): McpServer {
  const ctx = createContext(env);
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
    async ({ arxivId }) => {
      try {
        return mcpResult(await ingestPaper(ctx, { arxivId }));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "batch_ingest",
    {
      title: "Batch Ingest Papers",
      description:
        "Ingest multiple papers at once. Provide either a list of arxiv IDs or a search query.",
      inputSchema: {
        arxivIds: z.array(z.string()).optional().describe("List of arxiv IDs to ingest"),
        searchQuery: z
          .string()
          .optional()
          .describe("Search query to find and ingest papers from arxiv"),
      },
    },
    async ({ arxivIds, searchQuery }) => {
      try {
        return mcpResult(await batchIngest(ctx, { arxivIds, searchQuery }));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "search_papers",
    {
      title: "Search Papers",
      description: "Search ingested papers using hybrid semantic + keyword search.",
      inputSchema: {
        query: z.string().describe("Search query (keywords or natural language)"),
        category: z.string().optional().describe("Filter by arxiv category (e.g. cs.CL)"),
        yearFrom: z.number().optional().describe("Filter from this year"),
        yearTo: z.number().optional().describe("Filter up to this year"),
        limit: z.number().optional().describe("Max results (default 10)"),
      },
    },
    async (args) => {
      try {
        return mcpResult(await searchPapers(ctx, args));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
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
    async ({ paperId }) => {
      try {
        return mcpResult(await getPaper(ctx, { paperId }));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
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
          .enum(["queued", "metadata", "parsed", "extracted", "ready", "failed"])
          .optional()
          .describe("Filter by status"),
        sortBy: z.enum(["published_at", "created_at", "title"]).optional().describe("Sort field"),
        sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order"),
        cursor: z.string().optional().describe("Pagination cursor"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => {
      try {
        return mcpResult(await listPapers(ctx, args));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "find_related",
    {
      title: "Find Related Papers",
      description: "Find related papers via citations, shared methods, datasets, or authors.",
      inputSchema: {
        paperId: z.string().describe("Paper ID or arxiv ID"),
        linkTypes: z
          .array(
            z.enum(["citation", "cited_by", "shared_method", "shared_dataset", "shared_author"]),
          )
          .optional()
          .describe("Filter by relationship types"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => {
      try {
        return mcpResult(await findRelated(ctx, args));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.registerTool(
    "search_extractions",
    {
      title: "Search Extractions",
      description: "Search extracted structured knowledge across all papers.",
      inputSchema: {
        query: z.string().describe("Search query"),
        type: z
          .enum(["method", "dataset", "baseline", "metric", "result", "contribution", "limitation"])
          .optional()
          .describe("Filter by type"),
        limit: z.number().optional().describe("Max results"),
      },
    },
    async (args) => {
      try {
        return mcpResult(await searchExtractions(ctx, args));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  return server;
}

// Add MCP endpoint to the app
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transport.handleRequest(c.req.raw as any, body);
  },
);

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch, env: Env) => {
    const ctx = createContext(env);
    for (const message of batch.messages) {
      try {
        await processQueueMessage(ctx, message.body as QueueMessage);
        message.ack();
      } catch (error) {
        console.error("Error processing message:", error);
        message.retry();
      }
    }
  },
  scheduled: async (_controller, env, ctx) => {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
