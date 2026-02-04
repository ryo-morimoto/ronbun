import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, mockResponseError, captureConsole } from "./helpers.ts";

// Mock modules
vi.mock("../../src/lib/client.ts", () => ({
  createClient: vi.fn(),
  handleResponse: vi.fn(async (res: any) => {
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error("Authentication failed.");
    const body = await res.json().catch(() => null);
    const msg = body?.error || `${res.status}`;
    throw new Error(msg);
  }),
}));

vi.mock("../../src/lib/prompt.ts", () => ({
  confirmPrompt: vi.fn().mockResolvedValue(false),
  selectPrompt: vi.fn().mockResolvedValue("skip"),
}));

import { createClient } from "../../src/lib/client.ts";
import { confirmPrompt } from "../../src/lib/prompt.ts";

const readyPaperData = {
  paper: {
    id: "paper-1",
    arxiv_id: "2401.15884",
    title: "Test Paper Title",
    authors: ["Author A"],
    abstract: "Test abstract.",
    categories: ["cs.AI"],
    published_at: "2024-01-28T00:00:00Z",
    status: "ready",
  },
  sections: [{ heading: "Intro", position: 0 }],
  extractions: [{ type: "method", name: "Test" }],
  citations: [],
  citedBy: [],
};

describe("show command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        papers: {
          ":id": {
            $get: vi.fn(),
            status: { $get: vi.fn() },
            related: { $get: vi.fn() },
          },
          ingest: { $post: vi.fn() },
        },
        arxiv: {
          ":arxivId": {
            preview: { $get: vi.fn() },
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

  it("displays ready paper details", async () => {
    mockClient.api.papers[":id"].$get.mockResolvedValue(
      mockResponse(readyPaperData),
    );

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    expect(output.logs.some((l: string) => l.includes("Test Paper Title"))).toBe(true);
  });

  it("shows failed paper and offers re-ingest", async () => {
    const failedData = {
      paper: { ...readyPaperData.paper, status: "failed" },
      sections: [],
      extractions: [],
      citations: [],
      citedBy: [],
    };
    mockClient.api.papers[":id"].$get.mockResolvedValue(
      mockResponse(failedData),
    );

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    // confirmPrompt should have been called
    expect(confirmPrompt).toHaveBeenCalled();
  });

  it("handles 404 for arXiv ID by offering fetch", async () => {
    mockClient.api.papers[":id"].$get.mockResolvedValue(
      mockResponseError(404),
    );

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    // confirmPrompt asked for fetch
    expect(confirmPrompt).toHaveBeenCalled();
  });
});
