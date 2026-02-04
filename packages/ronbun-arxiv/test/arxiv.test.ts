import { describe, it, expect } from "vitest";
import { parseHtmlContent, parsePdfText } from "../src/parser.ts";

describe("parseHtmlContent", () => {
  it("extracts sections from headings", () => {
    const html = `
      <html><body>
        <h1>Introduction</h1>
        <p>This paper introduces a novel approach to solving problems in NLP using transformers.
        We build on recent advances in attention mechanisms and large-scale pretraining to propose
        a new architecture that achieves significant improvements across multiple benchmarks.</p>
        <h2>Methods</h2>
        <p>We propose a method based on attention mechanisms that improves performance significantly.
        Our approach combines multi-head self-attention with a novel gating mechanism that allows
        the model to selectively attend to relevant parts of the input sequence.</p>
        <h2>Results</h2>
        <p>Our method achieves state-of-the-art results on multiple benchmarks including GLUE and SuperGLUE.
        We observe consistent improvements of 2-3 points across all tasks compared to previous baselines.</p>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    const headings = result.sections.map((s) => s.heading);
    expect(headings).toContain("Introduction");
    expect(result.sections[0].level).toBe(1);
    expect(result.sections[0].position).toBe(0);
  });

  it("falls back to full text when no headings", () => {
    const html = `
      <html><body>
        <p>This is a paper with no section headings but enough content to be extracted as a single section.</p>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].heading).toBe("Full Text");
  });

  it("strips HTML tags and normalizes whitespace", () => {
    const html = `
      <html><body>
        <h1>Test Section</h1>
        <p>Some <strong>bold</strong> and <em>italic</em> text with   extra   spaces.</p>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    expect(result.sections[0].content).not.toContain("<strong>");
    expect(result.sections[0].content).not.toContain("<em>");
    expect(result.sections[0].content).not.toMatch(/\s{2,}/);
  });

  it("extracts arxiv ID references", () => {
    const html = `
      <html><body>
        <h1>Paper</h1>
        <p>Some text about the paper content that is long enough to be extracted.</p>
        <section id="bibliography">
          <li>Smith et al. (2023) arxiv.org/abs/2301.12345 Some reference title</li>
          <li>Jones et al. (2024) DOI: 10.1234/test.2024 Another reference</li>
        </section>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references[0].arxivId).toBe("2301.12345");
  });

  it("returns empty references when no ref section", () => {
    const html = `
      <html><body>
        <h1>Simple Paper</h1>
        <p>A paper without any references section that has enough content to be extracted.</p>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    expect(result.references).toHaveLength(0);
  });

  it("skips sections with very short content", () => {
    const html = `
      <html><body>
        <h1>Good Section</h1>
        <p>This section has enough content to meet the minimum threshold for extraction.</p>
        <h2>Empty</h2>
        <p>Too short</p>
        <h2>Another Good Section</h2>
        <p>This section also has plenty of content that exceeds the minimum length requirement.</p>
      </body></html>
    `;
    const result = parseHtmlContent(html);
    const headings = result.sections.map((s) => s.heading);
    expect(headings).toContain("Good Section");
    expect(headings).toContain("Another Good Section");
  });
});

describe("parsePdfText", () => {
  it("detects sections from numbered headings", () => {
    const text = [
      "Abstract",
      "This paper presents a new approach.",
      "We evaluate on multiple benchmarks.",
      "1. Introduction",
      "Natural language processing has seen tremendous growth.",
      "Transformer architectures have become the dominant approach.",
      "2. Methods",
      "We propose a novel architecture.",
      "The architecture combines attention with convolution.",
    ].join("\n");

    const result = parsePdfText(text);
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    const headings = result.sections.map((s) => s.heading);
    expect(headings).toContain("Abstract");
  });

  it("returns empty references", () => {
    const text = "Abstract\nSome content that is long enough to be extracted.\n";
    const result = parsePdfText(text);
    expect(result.references).toHaveLength(0);
  });

  it("assigns sequential positions", () => {
    const text = [
      "Abstract",
      "This is the abstract with enough text.",
      "1. Introduction",
      "This is the introduction section content.",
      "2. Methods",
      "This section describes the methodology.",
    ].join("\n");

    const result = parsePdfText(text);
    for (let i = 0; i < result.sections.length; i++) {
      expect(result.sections[i].position).toBe(i);
    }
  });
});
