import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, captureConsole } from "./helpers.ts";

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

describe("list command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        papers: {
          $get: vi.fn(),
        },
      },
    };
    vi.mocked(createClient).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    output.restore();
    vi.restoreAllMocks();
  });

  it("lists papers with default parameters", async () => {
    mockClient.api.papers.$get.mockResolvedValue(
      mockResponse({
        papers: [
          {
            arxiv_id: "2401.15884",
            title: "Paper A",
            categories: ["cs.AI"],
            published_at: "2024-01-28",
          },
          {
            arxiv_id: "2312.10997",
            title: "Paper B",
            categories: ["cs.CL"],
            published_at: "2023-12-15",
          },
        ],
        hasMore: false,
        cursor: null,
      }),
    );

    const listCommand = (await import("../../src/commands/list.ts")).default;
    await listCommand.run!({ args: { limit: "20" } } as any);

    expect(output.logs.some((l: string) => l.includes("Paper A"))).toBe(true);
    expect(output.logs.some((l: string) => l.includes("Paper B"))).toBe(true);
  });

  it("shows 'no papers found' for empty results", async () => {
    mockClient.api.papers.$get.mockResolvedValue(mockResponse({ papers: [], hasMore: false }));

    const listCommand = (await import("../../src/commands/list.ts")).default;
    await listCommand.run!({ args: { limit: "20" } } as any);

    expect(output.logs.some((l: string) => l.includes("No papers found"))).toBe(true);
  });

  it("passes filter parameters", async () => {
    mockClient.api.papers.$get.mockResolvedValue(mockResponse({ papers: [], hasMore: false }));

    const listCommand = (await import("../../src/commands/list.ts")).default;
    await listCommand.run!({
      args: { limit: "20", status: "ready", category: "cs.AI", year: "2024" },
    } as any);

    expect(mockClient.api.papers.$get).toHaveBeenCalledTimes(1);
  });
});
