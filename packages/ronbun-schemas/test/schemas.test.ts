import { describe, it, expect } from "vitest";
import {
  arxivIdSchema,
  ingestPaperInput,
  batchIngestInput,
  searchPapersInput,
  getPaperInput,
  listPapersInput,
  findRelatedInput,
  searchExtractionsInput,
  queueMessageSchema,
} from "../src/index.ts";

describe("arxivIdSchema", () => {
  it("accepts valid arxiv IDs", () => {
    expect(arxivIdSchema.parse("2401.15884")).toBe("2401.15884");
    expect(arxivIdSchema.parse("2312.00001")).toBe("2312.00001");
    expect(arxivIdSchema.parse("2401.15884v1")).toBe("2401.15884");
    expect(arxivIdSchema.parse("2401.15884v12")).toBe("2401.15884");
  });

  it("rejects invalid arxiv IDs", () => {
    expect(() => arxivIdSchema.parse("")).toThrow();
    expect(() => arxivIdSchema.parse("abc")).toThrow();
    expect(() => arxivIdSchema.parse("2401")).toThrow();
    expect(() => arxivIdSchema.parse("2401.123")).toThrow();
    expect(() => arxivIdSchema.parse("240.12345")).toThrow();
  });
});

describe("ingestPaperInput", () => {
  it("accepts valid input", () => {
    const result = ingestPaperInput.parse({ arxivId: "2401.15884" });
    expect(result.arxivId).toBe("2401.15884");
  });

  it("rejects missing arxivId", () => {
    expect(() => ingestPaperInput.parse({})).toThrow();
  });
});

describe("batchIngestInput", () => {
  it("accepts arxivIds", () => {
    const result = batchIngestInput.parse({
      arxivIds: ["2401.15884", "2312.00001"],
    });
    expect(result.arxivIds).toHaveLength(2);
  });

  it("accepts searchQuery", () => {
    const result = batchIngestInput.parse({
      searchQuery: "transformer attention",
    });
    expect(result.searchQuery).toBe("transformer attention");
  });

  it("accepts both arxivIds and searchQuery", () => {
    const result = batchIngestInput.parse({
      arxivIds: ["2401.15884"],
      searchQuery: "RAG",
    });
    expect(result.arxivIds).toHaveLength(1);
    expect(result.searchQuery).toBe("RAG");
  });

  it("rejects empty input (neither arxivIds nor searchQuery)", () => {
    expect(() => batchIngestInput.parse({})).toThrow();
  });

  it("rejects more than 50 arxivIds", () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `2401.${String(i).padStart(5, "0")}`,
    );
    expect(() => batchIngestInput.parse({ arxivIds: ids })).toThrow();
  });
});

describe("searchPapersInput", () => {
  it("accepts valid search with defaults", () => {
    const result = searchPapersInput.parse({ query: "attention mechanism" });
    expect(result.query).toBe("attention mechanism");
    expect(result.limit).toBe(10);
  });

  it("accepts all optional fields", () => {
    const result = searchPapersInput.parse({
      query: "RAG",
      category: "cs.CL",
      yearFrom: 2020,
      yearTo: 2024,
      limit: 5,
    });
    expect(result.category).toBe("cs.CL");
    expect(result.yearFrom).toBe(2020);
    expect(result.yearTo).toBe(2024);
    expect(result.limit).toBe(5);
  });

  it("rejects empty query", () => {
    expect(() => searchPapersInput.parse({ query: "" })).toThrow();
  });

  it("rejects limit > 50", () => {
    expect(() =>
      searchPapersInput.parse({ query: "test", limit: 51 }),
    ).toThrow();
  });
});

describe("getPaperInput", () => {
  it("accepts valid paperId", () => {
    const result = getPaperInput.parse({ paperId: "abc-123" });
    expect(result.paperId).toBe("abc-123");
  });

  it("rejects empty paperId", () => {
    expect(() => getPaperInput.parse({ paperId: "" })).toThrow();
  });
});

describe("listPapersInput", () => {
  it("applies defaults", () => {
    const result = listPapersInput.parse({});
    expect(result.sortBy).toBe("created_at");
    expect(result.sortOrder).toBe("desc");
    expect(result.limit).toBe(20);
  });

  it("accepts all filters", () => {
    const result = listPapersInput.parse({
      category: "cs.AI",
      year: 2024,
      status: "ready",
      sortBy: "published_at",
      sortOrder: "asc",
      limit: 50,
    });
    expect(result.status).toBe("ready");
    expect(result.sortBy).toBe("published_at");
  });

  it("rejects invalid status", () => {
    expect(() =>
      listPapersInput.parse({ status: "invalid" }),
    ).toThrow();
  });
});

describe("findRelatedInput", () => {
  it("accepts paperId with defaults", () => {
    const result = findRelatedInput.parse({ paperId: "abc" });
    expect(result.limit).toBe(10);
  });

  it("accepts linkTypes filter", () => {
    const result = findRelatedInput.parse({
      paperId: "abc",
      linkTypes: ["citation", "shared_method"],
    });
    expect(result.linkTypes).toHaveLength(2);
  });
});

describe("searchExtractionsInput", () => {
  it("accepts query with defaults", () => {
    const result = searchExtractionsInput.parse({ query: "BERT" });
    expect(result.limit).toBe(20);
  });

  it("accepts type filter", () => {
    const result = searchExtractionsInput.parse({
      query: "ImageNet",
      type: "dataset",
    });
    expect(result.type).toBe("dataset");
  });

  it("rejects invalid type", () => {
    expect(() =>
      searchExtractionsInput.parse({ query: "test", type: "invalid" }),
    ).toThrow();
  });
});

describe("queueMessageSchema", () => {
  it("accepts valid queue message", () => {
    const result = queueMessageSchema.parse({
      paperId: "abc",
      arxivId: "2401.15884",
      step: "metadata",
    });
    expect(result.step).toBe("metadata");
  });

  it("accepts all steps", () => {
    for (const step of ["metadata", "content", "extraction", "embedding"]) {
      const result = queueMessageSchema.parse({
        paperId: "abc",
        arxivId: "2401.15884",
        step,
      });
      expect(result.step).toBe(step);
    }
  });

  it("rejects invalid step", () => {
    expect(() =>
      queueMessageSchema.parse({
        paperId: "abc",
        arxivId: "2401.15884",
        step: "invalid",
      }),
    ).toThrow();
  });
});
