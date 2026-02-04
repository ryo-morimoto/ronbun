import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, mockResponseError, captureConsole } from "./helpers.ts";

vi.mock("../../src/lib/client.ts", () => ({
  createClient: vi.fn(),
  handleResponse: vi.fn(async (res: any) => {
    if (res.ok) return res.json();
    throw new Error(`${res.status}`);
  }),
}));

vi.mock("../../src/lib/prompt.ts", () => ({
  confirmPrompt: vi.fn().mockResolvedValue(false),
  selectPrompt: vi.fn().mockResolvedValue("skip"),
}));

import { createClient } from "../../src/lib/client.ts";

describe("status command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        papers: {
          ":id": {
            status: { $get: vi.fn() },
          },
        },
      },
    };
    vi.mocked(createClient).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    output.restore();
    vi.restoreAllMocks();
  });

  it("displays status for a ready paper", async () => {
    mockClient.api.papers[":id"].status.$get.mockResolvedValue(
      mockResponse({
        id: "paper-1",
        arxiv_id: "2401.15884",
        title: "Test Paper",
        status: "ready",
        created_at: "2024-01-28T00:00:00Z",
      }),
    );

    const statusCommand = (await import("../../src/commands/status.ts")).default;
    await statusCommand.run!({ args: { id: "2401.15884" } } as any);

    expect(output.logs.some((l: string) => l.includes("ready"))).toBe(true);
  });

  it("displays status for a queued paper", async () => {
    mockClient.api.papers[":id"].status.$get.mockResolvedValue(
      mockResponse({
        id: "paper-3",
        arxiv_id: "2405.00001",
        title: "Queued Paper",
        status: "queued",
        created_at: "2024-05-01T00:00:00Z",
      }),
    );

    const statusCommand = (await import("../../src/commands/status.ts")).default;
    await statusCommand.run!({ args: { id: "2405.00001" } } as any);

    expect(output.logs.some((l: string) => l.includes("queued"))).toBe(true);
  });

  it("displays error info for failed paper", async () => {
    mockClient.api.papers[":id"].status.$get.mockResolvedValue(
      mockResponse({
        id: "paper-fail",
        arxiv_id: "2407.00001",
        title: "Failed Paper",
        status: "failed",
        error: "fetch timeout",
        created_at: "2024-07-01T00:00:00Z",
      }),
    );

    const statusCommand = (await import("../../src/commands/status.ts")).default;
    await statusCommand.run!({ args: { id: "2407.00001" } } as any);

    expect(output.logs.some((l: string) => l.includes("failed"))).toBe(true);
  });
});
