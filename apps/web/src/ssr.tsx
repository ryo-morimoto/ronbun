import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import type { RonbunContext } from "@ronbun/api";
import { processQueueMessage } from "@ronbun/api";
import type { QueueMessage } from "@ronbun/types";
import { updatePaperError, markPaperFailed } from "@ronbun/database";
import { handleScheduled } from "./server/cron";
import { handleApiRequest } from "./server/api/router";
import { handleMcpRequest } from "./server/mcp/handler";

function createContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}

function resolveEnv(options: unknown): Env | null {
  if (hasBindings(options)) {
    return options;
  }
  if (!options || typeof options !== "object") {
    return null;
  }

  const candidate =
    (options as { context?: { env?: unknown } }).context?.env ??
    (options as { context?: { cloudflare?: { env?: unknown } } }).context?.cloudflare?.env;

  return hasBindings(candidate) ? candidate : null;
}

function hasBindings(value: unknown): value is Env {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "DB" in value && "STORAGE" in value;
}

const serverEntry = createServerEntry({
  async fetch(request, options: unknown) {
    const env = resolveEnv(options);
    const url = new URL(request.url);

    // Handle MCP endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      if (!env) {
        return new Response("Environment not available", { status: 500 });
      }
      return handleMcpRequest(request, env);
    }

    // Handle API requests
    if (url.pathname.startsWith("/api/")) {
      if (!env) {
        return new Response("Environment not available", { status: 500 });
      }
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }
    }

    // Handle TanStack Start app
    return handler.fetch(request);
  },
});

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // @ts-expect-error - TanStack Start's fetch signature is different from ExportedHandler
    return serverEntry.fetch(request, { env });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const ctx = createContext(env);
    const MAX_RETRIES = 3;
    for (const message of batch.messages) {
      const body = message.body as QueueMessage;
      try {
        await processQueueMessage(ctx, body);
        message.ack();
      } catch (error) {
        const errorInfo = JSON.stringify({
          step: body.step,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
          attempt: message.attempts,
        });
        await updatePaperError(ctx.db, body.paperId, errorInfo).catch(() => {});
        if (message.attempts >= MAX_RETRIES) {
          await markPaperFailed(ctx.db, body.paperId, errorInfo).catch(() => {});
          console.error(
            `[${body.step}] permanently failed after ${message.attempts} attempts:`,
            error,
          );
        } else {
          console.error(`[${body.step}] attempt ${message.attempts}/${MAX_RETRIES}:`, error);
        }
        message.retry();
      }
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
