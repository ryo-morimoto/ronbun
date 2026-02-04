import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchArxivMetadata,
  searchArxivPapers,
  searchArxivPapersWithMetadata,
} from "../src/api.ts";

const SAMPLE_ENTRY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.15884v1</id>
    <title>Corrective Retrieval Augmented Generation</title>
    <summary>Large language models inevitably exhibit hallucinations.</summary>
    <published>2024-01-28T00:00:00Z</published>
    <updated>2024-01-29T00:00:00Z</updated>
    <author><name>Shi-Qi Yan</name></author>
    <author><name>Jia-Chen Gu</name></author>
    <category term="cs.CL" />
    <category term="cs.AI" />
  </entry>
</feed>`;

const SAMPLE_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.15884v1</id>
    <title>Paper One</title>
    <summary>Abstract one.</summary>
    <published>2024-01-28T00:00:00Z</published>
    <author><name>Author A</name></author>
    <category term="cs.CL" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2312.10997v2</id>
    <title>Paper Two</title>
    <summary>Abstract two.</summary>
    <published>2023-12-15T00:00:00Z</published>
    <author><name>Author B</name></author>
    <author><name>Author C</name></author>
    <category term="cs.AI" />
    <category term="cs.LG" />
  </entry>
</feed>`;

const EMPTY_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
</feed>`;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchArxivMetadata", () => {
  it("parses metadata from valid XML response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_ENTRY_XML),
      }),
    );

    const metadata = await fetchArxivMetadata("2401.15884");
    expect(metadata.title).toBe("Corrective Retrieval Augmented Generation");
    expect(metadata.abstract).toBe("Large language models inevitably exhibit hallucinations.");
    expect(metadata.authors).toEqual(["Shi-Qi Yan", "Jia-Chen Gu"]);
    expect(metadata.categories).toEqual(["cs.CL", "cs.AI"]);
    expect(metadata.publishedAt).toBe("2024-01-28T00:00:00Z");
    expect(metadata.updatedAt).toBe("2024-01-29T00:00:00Z");

    expect(fetch).toHaveBeenCalledWith("https://export.arxiv.org/api/query?id_list=2401.15884");
  });

  it("throws when no entry found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(EMPTY_FEED_XML),
      }),
    );

    await expect(fetchArxivMetadata("9999.99999")).rejects.toThrow("No entry found");
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchArxivMetadata("2401.15884")).rejects.toThrow("arxiv API returned 503");
  });
});

describe("searchArxivPapers", () => {
  it("extracts arxiv IDs from search results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_SEARCH_XML),
      }),
    );

    const ids = await searchArxivPapers("retrieval augmented generation");
    expect(ids).toEqual(["2401.15884", "2312.10997"]);
  });

  it("deduplicates arxiv IDs", async () => {
    const xmlWithDuplicates = SAMPLE_SEARCH_XML.replace(
      "</feed>",
      `<entry><id>http://arxiv.org/abs/2401.15884v2</id></entry></feed>`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(xmlWithDuplicates),
      }),
    );

    const ids = await searchArxivPapers("test");
    expect(ids.filter((id) => id === "2401.15884").length).toBe(1);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(searchArxivPapers("test")).rejects.toThrow("arxiv search API returned 500");
  });
});

describe("searchArxivPapersWithMetadata", () => {
  it("parses full metadata from search results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_SEARCH_XML),
      }),
    );

    const results = await searchArxivPapersWithMetadata("test");
    expect(results.length).toBe(2);

    expect(results[0].arxivId).toBe("2401.15884");
    expect(results[0].title).toBe("Paper One");
    expect(results[0].authors).toEqual(["Author A"]);
    expect(results[0].categories).toEqual(["cs.CL"]);

    expect(results[1].arxivId).toBe("2312.10997");
    expect(results[1].authors).toEqual(["Author B", "Author C"]);
    expect(results[1].categories).toEqual(["cs.AI", "cs.LG"]);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      }),
    );

    await expect(searchArxivPapersWithMetadata("test")).rejects.toThrow(
      "arxiv search API returned 429",
    );
  });
});
