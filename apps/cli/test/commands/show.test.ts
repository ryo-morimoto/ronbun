import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockResponse, mockResponseError, captureConsole } from "./helpers.ts";

vi.mock("../../src/lib/client.ts", () => ({
  createClient: vi.fn(),
  hasApiToken: vi.fn(() => true),
  requireApiToken: vi.fn(),
  handleResponse: vi.fn(async (res: any) => {
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error("Authentication failed.");
    const body = await res.json().catch(() => null);
    const msg = body?.error || `${res.status}`;
    throw new Error(msg);
  }),
}));

import { createClient } from "../../src/lib/client.ts";

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
          },
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
    mockClient.api.papers[":id"].$get.mockResolvedValue(mockResponse(readyPaperData));

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    expect(output.logs.some((l: string) => l.includes("Test Paper Title"))).toBe(true);
  });

  it("shows failed paper with retry message", async () => {
    const failedData = {
      paper: { ...readyPaperData.paper, status: "failed" },
      sections: [],
      extractions: [],
      citations: [],
      citedBy: [],
    };
    mockClient.api.papers[":id"].$get.mockResolvedValue(mockResponse(failedData));

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    expect(output.logs.some((l: string) => l.includes("retried automatically"))).toBe(true);
  });

  it("handles 404 for arXiv ID by showing preview", async () => {
    mockClient.api.papers[":id"].$get.mockResolvedValue(mockResponseError(404));
    mockClient.api.arxiv[":arxivId"].preview.$get.mockResolvedValue(
      mockResponse({
        arxivId: "2401.15884",
        title: "Preview Title",
        authors: ["Author A"],
        abstract: "Preview abstract",
        bodyText: null,
      }),
    );

    const showCommand = (await import("../../src/commands/show.ts")).default;
    await showCommand.run!({ args: { id: "2401.15884" } } as any);

    expect(output.logs.some((l: string) => l.includes("not ingested yet"))).toBe(true);
  });
});
