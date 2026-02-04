import { describe, it, expect } from "vitest";
import { isArxivId, stripVersion } from "../../src/lib/arxiv-id.ts";

describe("isArxivId", () => {
  it("accepts valid arxiv IDs", () => {
    expect(isArxivId("2401.15884")).toBe(true);
    expect(isArxivId("2312.04321")).toBe(true);
  });

  it("accepts IDs with version suffix", () => {
    expect(isArxivId("2401.15884v1")).toBe(true);
    expect(isArxivId("2401.15884v12")).toBe(true);
  });

  it("rejects non-arxiv strings", () => {
    expect(isArxivId("hello")).toBe(false);
    expect(isArxivId("")).toBe(false);
    expect(isArxivId("hep-th/9905111")).toBe(false);
    expect(isArxivId("2401")).toBe(false);
  });
});

describe("stripVersion", () => {
  it("strips version suffix", () => {
    expect(stripVersion("2401.15884v1")).toBe("2401.15884");
    expect(stripVersion("2401.15884v12")).toBe("2401.15884");
  });

  it("returns unchanged if no version", () => {
    expect(stripVersion("2401.15884")).toBe("2401.15884");
  });
});
