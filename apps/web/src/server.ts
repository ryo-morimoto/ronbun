import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

export { ArxivFetchScheduler } from "./server/do/arxiv-fetch-scheduler";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import { processContent } from "@ronbun/api";
import type { QueueMessage } from "@ronbun/types";
import { updatePaperError, markPaperFailed } from "@ronbun/database";
import { handleScheduled } from "./server/cron";
import { handleApiRequest } from "./server/api/router";
import {
  createRonbunContext,
  describeMissingRonbunContextBindings,
  resolveEnvFromOptions,
} from "./server/context";

const startFetch = createStartHandler(defaultStreamHandler);

export type ServerEntry = { fetch: RequestHandler<Register> };

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args);
    },
  };
}

function missingBindingsResponse(options: unknown): Response {
  const missingBindings = describeMissingRonbunContextBindings(options);

  return new Response(`Environment bindings not available: ${missingBindings.join(", ")}`, {
    status: 500,
  });
}

const serverEntry = createServerEntry({
  async fetch(request, options: unknown) {
    const env = resolveEnvFromOptions(options);
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!env) {
        return missingBindingsResponse(options);
      }
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }
    }

    return startFetch(request, options as any);
  },
});

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return serverEntry.fetch(request, env as any);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const ctx = createRonbunContext(env);
    const maxRetries = 3;
    for (const message of batch.messages) {
      const body = message.body as QueueMessage;
      try {
        await processContent(ctx, body);
        message.ack();
      } catch (error) {
        const errorInfo = JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
          attempt: message.attempts,
        });
        await updatePaperError(ctx.db, body.paperId, errorInfo).catch(() => {});
        if (message.attempts >= maxRetries) {
          await markPaperFailed(ctx.db, body.paperId, errorInfo).catch(() => {});
          console.error(`[content] permanently failed after ${message.attempts} attempts:`, error);
        } else {
          console.error(`[content] attempt ${message.attempts}/${maxRetries}:`, error);
        }
        message.retry();
      }
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
