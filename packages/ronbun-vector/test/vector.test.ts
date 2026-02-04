import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEmbedding, semanticSearch, upsertSectionEmbeddings } from "../src/index.ts";

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
        { id: "sec-1", score: 0.95, metadata: { paperId: "paper-1" } },
        { id: "sec-2", score: 0.85, metadata: { paperId: "paper-2" } },
        { id: "sec-3", score: 0.75, metadata: { paperId: "paper-1" } }, // duplicate paperId
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
    const scores = await semanticSearch(vectorIndex, ai, "test query", 10);

    expect(scores.size).toBe(2); // paper-1 and paper-2 (deduplicated)
    expect(scores.get("paper-1")).toBe(0);
    expect(scores.get("paper-2")).toBe(1);
    expect(vectorIndex.query).toHaveBeenCalledWith([0.1, 0.2, 0.3, 0.4, 0.5], {
      topK: 10,
      returnMetadata: "all",
    });
  });

  it("returns empty map on error", async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error("AI failed")) } as unknown as Ai;
    const vectorIndex = createMockVectorIndex();
    const scores = await semanticSearch(vectorIndex, ai, "test", 10);
    expect(scores.size).toBe(0);
  });

  it("falls back to match.id when metadata.paperId is missing", async () => {
    const ai = createMockAi();
    const vectorIndex = {
      query: vi.fn().mockResolvedValue({
        matches: [
          { id: "sec-1", score: 0.9, metadata: {} },
        ],
      }),
    } as unknown as VectorizeIndex;

    const scores = await semanticSearch(vectorIndex, ai, "test", 5);
    expect(scores.get("sec-1")).toBe(0);
  });
});

describe("upsertSectionEmbeddings", () => {
  it("generates embeddings and upserts vectors", async () => {
    const ai = createMockAi();
    const vectorIndex = createMockVectorIndex();

    const sections = [
      { id: "sec-1", heading: "Intro", content: "Introduction content" },
      { id: "sec-2", heading: "Methods", content: "Methods content" },
    ];

    const count = await upsertSectionEmbeddings(vectorIndex, ai, "paper-1", sections);
    expect(count).toBe(2);
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(vectorIndex.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertCall).toHaveLength(2);
    expect(upsertCall[0].id).toBe("sec-1");
    expect(upsertCall[0].metadata).toEqual({
      paperId: "paper-1",
      sectionId: "sec-1",
      heading: "Intro",
    });
  });

  it("skips sections that fail embedding", async () => {
    const ai = {
      run: vi.fn()
        .mockResolvedValueOnce({ data: [[0.1, 0.2]] })
        .mockRejectedValueOnce(new Error("embedding failed"))
        .mockResolvedValueOnce({ data: [[0.3, 0.4]] }),
    } as unknown as Ai;
    const vectorIndex = createMockVectorIndex();

    const sections = [
      { id: "sec-1", heading: "Intro", content: "Intro" },
      { id: "sec-2", heading: "Methods", content: "Methods" },
      { id: "sec-3", heading: "Results", content: "Results" },
    ];

    const count = await upsertSectionEmbeddings(vectorIndex, ai, "paper-1", sections);
    expect(count).toBe(2);
    expect(vectorIndex.upsert).toHaveBeenCalledTimes(1);
    const vectors = (vectorIndex.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(vectors).toHaveLength(2);
    expect(vectors[0].id).toBe("sec-1");
    expect(vectors[1].id).toBe("sec-3");
  });

  it("does not call upsert when all sections fail", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("all fail")),
    } as unknown as Ai;
    const vectorIndex = createMockVectorIndex();

    const sections = [
      { id: "sec-1", heading: "Intro", content: "Intro" },
    ];

    const count = await upsertSectionEmbeddings(vectorIndex, ai, "paper-1", sections);
    expect(count).toBe(0);
    expect(vectorIndex.upsert).not.toHaveBeenCalled();
  });

  it("does not call upsert for empty sections array", async () => {
    const ai = createMockAi();
    const vectorIndex = createMockVectorIndex();

    const count = await upsertSectionEmbeddings(vectorIndex, ai, "paper-1", []);
    expect(count).toBe(0);
    expect(vectorIndex.upsert).not.toHaveBeenCalled();
  });

  it("truncates content to 8000 chars", async () => {
    const ai = createMockAi();
    const vectorIndex = createMockVectorIndex();
    const longContent = "a".repeat(10000);

    await upsertSectionEmbeddings(vectorIndex, ai, "paper-1", [
      { id: "sec-1", heading: "Test", content: longContent },
    ]);

    const calledText = (ai.run as ReturnType<typeof vi.fn>).mock.calls[0][1].text[0];
    expect(calledText.length).toBe(8000);
  });
});
