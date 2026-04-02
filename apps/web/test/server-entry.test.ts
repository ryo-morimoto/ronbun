import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startFetch: vi.fn(),
  handleApiRequest: vi.fn(),
  processContent: vi.fn(),
  updatePaperError: vi.fn(),
  markPaperFailed: vi.fn(),
  handleScheduled: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: vi.fn(() => mocks.startFetch),
  defaultStreamHandler: {},
}));

vi.mock("../src/server/api/router", () => ({
  handleApiRequest: mocks.handleApiRequest,
}));

vi.mock("@ronbun/api", () => ({
  processContent: mocks.processContent,
}));

vi.mock("@ronbun/database", () => ({
  updatePaperError: mocks.updatePaperError,
  markPaperFailed: mocks.markPaperFailed,
}));

vi.mock("../src/server/cron", () => ({
  handleScheduled: mocks.handleScheduled,
}));

const { default: worker } = await import("../src/server");
const { resolveEnvFromOptions, describeMissingRonbunContextBindings } =
  await import("../src/server/context");

function createRuntimeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: { binding: "db" },
    STORAGE: { binding: "storage" },
    VECTOR_INDEX: { binding: "vector" },
    AI: { binding: "ai" },
    INGEST_QUEUE: { binding: "queue" },
    INGEST_DLQ: { binding: "dlq" },
    API_TOKEN: "test-token",
    ARXIV_CATEGORIES: "cs.AI,cs.CL",
    ...overrides,
  };
}

function createQueueBatch(attempts = 1) {
  const message = {
    id: "msg-1",
    timestamp: new Date(),
    body: {
      paperId: "paper-1",
      arxivId: "2401.15884",
    },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };

  const batch = {
    queue: "ingest",
    messages: [message],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };

  return {
    batch,
    message,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();

  mocks.startFetch.mockResolvedValue(new Response("start"));
  mocks.handleApiRequest.mockResolvedValue(null);
  mocks.processContent.mockResolvedValue(undefined);
  mocks.updatePaperError.mockResolvedValue(undefined);
  mocks.markPaperFailed.mockResolvedValue(undefined);
  mocks.handleScheduled.mockResolvedValue(undefined);

  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveEnvFromOptions", () => {
  it("resolves direct env and nested env values", () => {
    const env = createRuntimeEnv();

    expect(resolveEnvFromOptions(env)).toBe(env);
    expect(resolveEnvFromOptions({ env })).toBe(env);
    expect(resolveEnvFromOptions({ context: { env } })).toBe(env);
    expect(resolveEnvFromOptions({ context: { cloudflare: { env } } })).toBe(env);
  });

  it("returns null and reports missing bindings for invalid options", () => {
    expect(resolveEnvFromOptions({ env: { DB: {} } })).toBeNull();
    expect(describeMissingRonbunContextBindings({ env: { DB: {} } })).toEqual([
      "STORAGE",
      "VECTOR_INDEX",
      "AI",
      "INGEST_QUEUE",
    ]);
  });
});

describe("fetch routing", () => {
  it("routes /api/* to API handler and falls back to SSR when API returns null", async () => {
    const env = createRuntimeEnv();

    mocks.handleApiRequest.mockResolvedValueOnce(new Response("api-ok"));
    const apiResponse = await worker.fetch(
      new Request("http://localhost/api/health"),
      env,
      {} as ExecutionContext,
    );

    expect(await apiResponse.text()).toBe("api-ok");
    expect(mocks.startFetch).not.toHaveBeenCalled();

    mocks.handleApiRequest.mockResolvedValueOnce(null);
    mocks.startFetch.mockResolvedValueOnce(new Response("ssr-fallback"));
    const fallbackResponse = await worker.fetch(
      new Request("http://localhost/api/unknown"),
      env,
      {} as ExecutionContext,
    );

    expect(await fallbackResponse.text()).toBe("ssr-fallback");
    expect(mocks.startFetch).toHaveBeenCalledTimes(1);
  });
});

describe("queue and scheduled handlers", () => {
  it("acks queue messages on successful processing", async () => {
    const env = createRuntimeEnv();
    const { batch, message } = createQueueBatch();

    await worker.queue(batch as unknown as MessageBatch<unknown>, env);

    expect(mocks.processContent).toHaveBeenCalledWith(
      expect.objectContaining({
        db: env.DB,
        storage: env.STORAGE,
        vectorIndex: env.VECTOR_INDEX,
        ai: env.AI,
        queue: env.INGEST_QUEUE,
      }),
      message.body,
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("updates error and retries when queue processing fails below max retries", async () => {
    const env = createRuntimeEnv();
    const { batch, message } = createQueueBatch(1);
    mocks.processContent.mockRejectedValueOnce(new Error("processing failed"));

    await worker.queue(batch as unknown as MessageBatch<unknown>, env);

    expect(mocks.updatePaperError).toHaveBeenCalledWith(
      env.DB,
      "paper-1",
      expect.stringContaining('"attempt":1'),
    );
    expect(mocks.markPaperFailed).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
  });

  it("marks paper failed when queue processing exceeds max retries", async () => {
    const env = createRuntimeEnv();
    const { batch, message } = createQueueBatch(3);
    mocks.processContent.mockRejectedValueOnce(new Error("processing failed"));

    await worker.queue(batch as unknown as MessageBatch<unknown>, env);

    expect(mocks.updatePaperError).toHaveBeenCalledTimes(1);
    expect(mocks.markPaperFailed).toHaveBeenCalledWith(
      env.DB,
      "paper-1",
      expect.stringContaining('"attempt":3'),
    );
    expect(message.retry).toHaveBeenCalledTimes(1);
  });

  it("delegates scheduled events to cron handler with waitUntil", async () => {
    const env = createRuntimeEnv();
    const waitUntil = vi.fn();

    await worker.scheduled({} as ScheduledController, env, {
      waitUntil,
    } as unknown as ExecutionContext);

    expect(mocks.handleScheduled).toHaveBeenCalledWith(env);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });
});
