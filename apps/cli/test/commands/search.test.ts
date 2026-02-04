import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, captureConsole } from "./helpers.ts";

vi.mock("../../src/lib/client.ts", () => ({
  createClient: vi.fn(),
  hasApiToken: vi.fn(() => true),
  requireApiToken: vi.fn(),
  handleResponse: vi.fn(async (res: any) => {
    if (res.ok) return res.json();
    throw new Error(`${res.status}`);
  }),
}));

vi.mock("../../src/lib/prompt.ts", () => ({
  confirmPrompt: vi.fn().mockResolvedValue(false),
  selectPrompt: vi.fn().mockResolvedValue("skip"),
}));

import { createClient, hasApiToken } from "../../src/lib/client.ts";

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
          "batch-ingest": {
            $post: vi.fn(),
          },
        },
        arxiv: {
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

  it("displays local search results", async () => {
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

  it("offers arXiv fallback when no local results", async () => {
    mockClient.api.papers.search.$post.mockResolvedValue(mockResponse({ papers: [] }));

    const searchCommand = (await import("../../src/commands/search.ts")).default;
    await searchCommand.run!({ args: { query: "noresult", limit: "10" } } as any);

    // confirmPrompt was called for arXiv fallback
    const { confirmPrompt } = await import("../../src/lib/prompt.ts");
    expect(confirmPrompt).toHaveBeenCalled();
  });

  it("shows credentials message instead of ingest prompt when token is missing", async () => {
    mockClient.api.papers.search.$post.mockResolvedValue(mockResponse({ papers: [] }));
    mockClient.api.arxiv.search.$post.mockResolvedValue(
      mockResponse({
        papers: [{ arxiv_id: "2401.15884", title: "Remote Paper", published_at: "2024-01-28" }],
      }),
    );
    vi.mocked(hasApiToken).mockReturnValue(false);
    const { confirmPrompt } = await import("../../src/lib/prompt.ts");
    vi.mocked(confirmPrompt).mockResolvedValue(true);

    const searchCommand = (await import("../../src/commands/search.ts")).default;
    await searchCommand.run!({ args: { query: "noresult", limit: "10" } } as any);

    const { selectPrompt } = await import("../../src/lib/prompt.ts");
    expect(selectPrompt).not.toHaveBeenCalled();
    expect(output.logs.some((l: string) => l.includes("Credentials are required"))).toBe(true);
  });
});
