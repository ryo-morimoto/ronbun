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

describe("related command", () => {
  let output: ReturnType<typeof captureConsole>;
  let mockClient: any;

  beforeEach(() => {
    output = captureConsole();
    mockClient = {
      api: {
        papers: {
          ":id": {
            related: { $get: vi.fn() },
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

  it("displays related papers", async () => {
    mockClient.api.papers[":id"].related.$get.mockResolvedValue(
      mockResponse({
        papers: [
          {
            arxiv_id: "2312.10997",
            title: "Related Paper",
            linkType: "shared_method",
            categories: ["cs.CL"],
            published_at: "2023-12-15",
          },
        ],
      }),
    );

    const relatedCommand = (await import("../../src/commands/related.ts")).default;
    await relatedCommand.run!({ args: { id: "2401.15884", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("Related Paper"))).toBe(true);
  });

  it("shows 'no related papers found' for empty results", async () => {
    mockClient.api.papers[":id"].related.$get.mockResolvedValue(mockResponse({ papers: [] }));

    const relatedCommand = (await import("../../src/commands/related.ts")).default;
    await relatedCommand.run!({ args: { id: "2401.15884", limit: "10" } } as any);

    expect(output.logs.some((l: string) => l.includes("No related papers found"))).toBe(true);
  });
});
