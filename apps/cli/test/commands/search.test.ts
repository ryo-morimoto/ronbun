import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, captureConsole } from "./helpers.ts";

vi.mock("../../src/lib/client.ts", () => ({
  createClient: vi.fn(),
  handleResponse: vi.fn(async (res: any) => {
    if (res.ok) return res.json();
    throw new Error(`${res.status}`);
  }),
}));

import { createClient } from "../../src/lib/client.ts";

describe("search command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        papers: {
          search: {
            $post: vi.fn(),
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

  it("displays search results", async () => {
    mockClient.api.papers.search.$post.mockResolvedValue(
      mockResponse({
        papers: [
          {
            arxiv_id: "2401.15884",
            title: "Test Paper",
            categories: ["cs.AI"],
            published_at: "2024-01-28",
          },
        ],
      }),
    );

    const searchCommand = (await import("../../src/commands/search.ts")).default;
    await searchCommand.run!({ args: { query: "retrieval", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("Test Paper"))).toBe(true);
  });

  it("shows no results message when empty", async () => {
    mockClient.api.papers.search.$post.mockResolvedValue(mockResponse({ papers: [] }));

    const searchCommand = (await import("../../src/commands/search.ts")).default;
    await searchCommand.run!({ args: { query: "noresult", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("No results found"))).toBe(true);
  });

  it("passes filter parameters", async () => {
    mockClient.api.papers.search.$post.mockResolvedValue(mockResponse({ papers: [] }));

    const searchCommand = (await import("../../src/commands/search.ts")).default;
    await searchCommand.run!({
      args: { query: "test", category: "cs.AI", "year-from": "2024", limit: "5" },
    } as any);

    expect(mockClient.api.papers.search.$post).toHaveBeenCalledWith({
      json: {
        query: "test",
        category: "cs.AI",
        yearFrom: 2024,
        yearTo: undefined,
        limit: 5,
      },
    });
  });
});
