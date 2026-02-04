import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { storeHtml, getHtml, storePdf, getPdf } from "../src/index.ts";

describe("storage", () => {
  describe("storeHtml + getHtml", () => {
    it("stores and retrieves HTML content", async () => {
      const html = "<html><body><h1>Test Paper</h1></body></html>";
      await storeHtml(env.STORAGE, "2401.15884", html);
      const retrieved = await getHtml(env.STORAGE, "2401.15884");
      expect(retrieved).toBe(html);
    });

    it("returns null for non-existent HTML", async () => {
      const result = await getHtml(env.STORAGE, "9999.99999");
      expect(result).toBeNull();
    });

    it("overwrites existing HTML", async () => {
      await storeHtml(env.STORAGE, "2401.00100", "old content");
      await storeHtml(env.STORAGE, "2401.00100", "new content");
      const result = await getHtml(env.STORAGE, "2401.00100");
      expect(result).toBe("new content");
    });
  });

  describe("storePdf + getPdf", () => {
    it("stores and retrieves PDF content", async () => {
      const pdfContent = new TextEncoder().encode("fake pdf content").buffer;
      await storePdf(env.STORAGE, "2401.15884", pdfContent);
      const retrieved = await getPdf(env.STORAGE, "2401.15884");
      expect(retrieved).not.toBeNull();
      const text = new TextDecoder().decode(retrieved!);
      expect(text).toBe("fake pdf content");
    });

    it("returns null for non-existent PDF", async () => {
      const result = await getPdf(env.STORAGE, "9999.99999");
      expect(result).toBeNull();
    });
  });
});
