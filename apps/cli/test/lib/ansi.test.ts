import { describe, it, expect } from "vitest";
import { truncate } from "../../src/lib/ansi.ts";

describe("truncate", () => {
  it("returns string unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns string unchanged if exactly at limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates with ellipsis when over limit", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
