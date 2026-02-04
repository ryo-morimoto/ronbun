import { describe, it, expect } from "vitest";
import { formatPaperRow, formatStatus, formatStatusDetail } from "../../src/lib/format.ts";

describe("formatPaperRow", () => {
  it("formats a paper row with all fields", () => {
    const row = {
      arxivId: "2401.15884",
      title: "Attention Is All You Need",
      categories: "cs.CL",
      publishedAt: "2024-01-28",
    };
    const output = formatPaperRow(row);
    expect(output).toContain("2401.15884");
    expect(output).toContain("Attention Is All You Need");
    expect(output).toContain("cs.CL");
    expect(output).toContain("2024");
  });

  it("handles missing fields", () => {
    const output = formatPaperRow({});
    expect(output).toContain("(untitled)");
  });

  it("handles array categories", () => {
    const row = {
      arxivId: "2401.15884",
      title: "Test",
      categories: ["cs.CL", "cs.AI"],
      publishedAt: "2024-01-28",
    };
    const output = formatPaperRow(row);
    expect(output).toContain("cs.CL");
  });
});

describe("formatStatus", () => {
  it("returns non-empty for each status", () => {
    expect(formatStatus("ready").length).toBeGreaterThan(0);
    expect(formatStatus("failed").length).toBeGreaterThan(0);
    expect(formatStatus("queued").length).toBeGreaterThan(0);
  });
});

describe("formatStatusDetail", () => {
  it("formats status detail", () => {
    const paper = {
      arxiv_id: "2401.15884",
      title: "Test Paper",
      status: "ready",
      created_at: "2024-01-28T10:00:00Z",
    };
    const output = formatStatusDetail(paper);
    expect(output).toContain("2401.15884");
    expect(output).toContain("Test Paper");
  });

  it("shows error for failed papers", () => {
    const paper = {
      arxiv_id: "2401.15884",
      title: "Test Paper",
      status: "failed",
      error: "PDF parsing timeout",
    };
    const output = formatStatusDetail(paper);
    expect(output).toContain("PDF parsing timeout");
  });
});
