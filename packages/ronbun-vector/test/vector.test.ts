import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmbedding, semanticSearch, upsertPaperEmbedding } from "../src/index.ts";

function createMockAi() {
  return {
    run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3, 0.4, 0.5]] }),
  } as unknown as Ai;
}

function createMockVectorIndex() {
  return {
    upsert: vi.fn().mockResolvedValue(null),
    query: vi.fn().mockResolvedValue({
      matches: [
        { id: "paper-1", score: 0.95, metadata: { paperId: "paper-1" } },
        { id: "paper-2", score: 0.85, metadata: { paperId: "paper-2" } },
      ],
    }),
  } as unknown as VectorizeIndex;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("generateEmbedding", () => {
  it("calls ai.run with correct model and text", async () => {
    const ai = createMockAi();
    const result = await generateEmbedding(ai, "test text");
    expect(ai.run).toHaveBeenCalledWith("@cf/baai/bge-large-en-v1.5", { text: ["test text"] });
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe("semanticSearch", () => {
  it("returns paperId to rank map", async () => {
    const ai = createMockAi();
    const vectorIndex = createMockVectorIndex();
    const result = await semanticSearch(vectorIndex, ai, "test query", 10);

    expect(result.scores.size).toBe(2);
    expect(result.scores.get("paper-1")).toBe(0);
    expect(result.scores.get("paper-2")).toBe(1);
    expect(result.degraded).toBe(false);
    expect(vectorIndex.query).toHaveBeenCalledWith([0.1, 0.2, 0.3, 0.4, 0.5], {
      topK: 10,
      returnMetadata: "all",
    });
  });

  it("returns empty map and degraded flag on error", async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error("AI failed")) } as unknown as Ai;
    const vectorIndex = createMockVectorIndex();
    const result = await semanticSearch(vectorIndex, ai, "test", 10);
    expect(result.scores.size).toBe(0);
    expect(result.degraded).toBe(true);
  });

  it("falls back to match.id when metadata.paperId is missing", async () => {
    const ai = createMockAi();
    const vectorIndex = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: "paper-1", score: 0.9, metadata: {} }],
      }),
    } as unknown as VectorizeIndex;

    const result = await semanticSearch(vectorIndex, ai, "test", 5);
    expect(result.scores.get("paper-1")).toBe(0);
    expect(result.degraded).toBe(false);
  });
});

describe("upsertPaperEmbedding", () => {
  it("generates embedding from abstract and upserts single vector", async () => {
    const ai = createMockAi();
    const vectorIndex = createMockVectorIndex();

    await upsertPaperEmbedding(vectorIndex, ai, "paper-1", "This is the abstract text");

    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(vectorIndex.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertCall).toHaveLength(1);
    expect(upsertCall[0].id).toBe("paper-1");
    expect(upsertCall[0].metadata).toEqual({ paperId: "paper-1" });
  });
});
