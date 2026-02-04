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

describe("extractions command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        extractions: {
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

  it("displays extraction results", async () => {
    mockClient.api.extractions.search.$post.mockResolvedValue(
      mockResponse({
        extractions: [
          { type: "method", name: "CRAG", detail: "Corrective RAG", paper_title: "Test Paper", arxiv_id: "2401.15884" },
        ],
      }),
    );

    const extractionsCommand = (await import("../../src/commands/extractions.ts")).default;
    await extractionsCommand.run!({ args: { query: "CRAG", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("Corrective RAG") || l.includes("method"))).toBe(true);
  });

  it("shows 'no extractions found' for empty results", async () => {
    mockClient.api.extractions.search.$post.mockResolvedValue(
      mockResponse({ extractions: [] }),
    );

    const extractionsCommand = (await import("../../src/commands/extractions.ts")).default;
    await extractionsCommand.run!({ args: { query: "noresult", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("No extractions found"))).toBe(true);
  });
});
