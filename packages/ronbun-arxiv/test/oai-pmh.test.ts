import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchNewPapers,
  fetchNewPapersByCategory,
  fetchNewPapersWithMetadata,
} from "../src/oai-pmh.ts";

const SAMPLE_OAI_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15884</identifier></header>
      <metadata><arXiv xmlns="http://arxiv.org/OAI/arXiv/">
        <id>2401.15884</id><created>2024-01-29</created>
        <authors><author><keyname>A</keyname></author></authors>
        <title>Paper A</title><categories>cs.AI</categories>
        <abstract>Abstract A</abstract>
      </arXiv></metadata>
    </record>
    <record>
      <header><identifier>oai:arXiv.org:2401.15885</identifier></header>
      <metadata><arXiv xmlns="http://arxiv.org/OAI/arXiv/">
        <id>2401.15885</id><created>2024-01-30</created>
        <authors><author><keyname>B</keyname></author></authors>
        <title>Paper B</title><categories>cs.CL</categories>
        <abstract>Abstract B</abstract>
      </arXiv></metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;

const SAMPLE_OAI_WITH_RESUMPTION = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15886</identifier></header>
      <metadata><arXiv xmlns="http://arxiv.org/OAI/arXiv/">
        <id>2401.15886</id><created>2024-01-31</created>
        <authors><author><keyname>C</keyname></author></authors>
        <title>Paper C</title><categories>cs.LG</categories>
        <abstract>Abstract C</abstract>
      </arXiv></metadata>
    </record>
    <resumptionToken>token123</resumptionToken>
  </ListRecords>
</OAI-PMH>`;

const SAMPLE_OAI_PAGE2 = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15887</identifier></header>
      <metadata><arXiv xmlns="http://arxiv.org/OAI/arXiv/">
        <id>2401.15887</id><created>2024-02-01</created>
        <authors><author><keyname>D</keyname></author></authors>
        <title>Paper D</title><categories>cs.CV</categories>
        <abstract>Abstract D</abstract>
      </arXiv></metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;

const NO_RECORDS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <error code="noRecordsMatch">No records match the request</error>
</OAI-PMH>`;

const SAMPLE_OAI_ARXIV_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15884</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.15884</id>
          <created>2024-01-29</created>
          <updated>2024-02-01</updated>
          <authors>
            <author><keyname>Smith</keyname><forenames>John A.</forenames></author>
            <author><keyname>van der Berg</keyname><forenames>Maria</forenames></author>
          </authors>
          <title>A Novel Approach to Testing</title>
          <categories>cs.AI cs.CL</categories>
          <abstract>We present a novel approach.</abstract>
        </arXiv>
      </metadata>
    </record>
    <record>
      <header><identifier>oai:arXiv.org:2401.15885</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.15885</id>
          <created>2024-01-30</created>
          <updated>2024-01-30</updated>
          <authors>
            <author><keyname>Doe</keyname><forenames>Jane</forenames></author>
          </authors>
          <title>Another Paper on ML</title>
          <categories>cs.LG</categories>
          <abstract>This paper explores ML techniques.</abstract>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

describe("fetchNewPapersWithMetadata", () => {
  it("parses records with full metadata fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_ARXIV_METADATA),
      }),
    );

    const promise = fetchNewPapersWithMetadata("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const records = await promise;

    expect(records).toHaveLength(2);

    const first = records[0];
    expect(first.arxivId).toBe("2401.15884");
    expect(first.title).toBe("A Novel Approach to Testing");
    expect(first.authors).toEqual(["John A. Smith", "Maria van der Berg"]);
    expect(first.abstract).toBe("We present a novel approach.");
    expect(first.categories).toEqual(["cs.AI", "cs.CL"]);
    expect(first.publishedAt).toBe("2024-01-29");
    expect(first.updatedAt).toBe("2024-02-01");

    const second = records[1];
    expect(second.arxivId).toBe("2401.15885");
    expect(second.authors).toEqual(["Jane Doe"]);
    expect(second.categories).toEqual(["cs.LG"]);
  });

  it("returns empty array on noRecordsMatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(NO_RECORDS_RESPONSE),
      }),
    );

    const promise = fetchNewPapersWithMetadata("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const records = await promise;
    expect(records).toEqual([]);
  });

  it("deduplicates records with the same arxivId", async () => {
    const duplicateResponse = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15884</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.15884</id>
          <created>2024-01-29</created>
          <updated>2024-01-29</updated>
          <authors><author><keyname>Smith</keyname><forenames>John</forenames></author></authors>
          <title>Duplicate Paper</title>
          <categories>cs.AI</categories>
          <abstract>Abstract.</abstract>
        </arXiv>
      </metadata>
    </record>
    <record>
      <header><identifier>oai:arXiv.org:2401.15884</identifier></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.15884</id>
          <created>2024-01-29</created>
          <updated>2024-01-29</updated>
          <authors><author><keyname>Smith</keyname><forenames>John</forenames></author></authors>
          <title>Duplicate Paper</title>
          <categories>cs.AI</categories>
          <abstract>Abstract.</abstract>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(duplicateResponse),
      }),
    );

    const promise = fetchNewPapersWithMetadata("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const records = await promise;
    expect(records).toHaveLength(1);
  });
});

describe("fetchNewPapers", () => {
  it("fetches all papers without set parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE),
      }),
    );

    const promise = fetchNewPapers("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toEqual(["2401.15884", "2401.15885"]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("oaipmh.arxiv.org/oai"),
      expect.anything(),
    );
    // Should NOT contain set parameter
    expect((fetch as any).mock.calls[0][0]).not.toContain("set=");
  });

  it("handles resumption token pagination", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_WITH_RESUMPTION),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_PAGE2),
      });
    vi.stubGlobal("fetch", mockFetch);

    const promise = fetchNewPapers("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toEqual(["2401.15886", "2401.15887"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain("resumptionToken=token123");
  });

  it("handles noRecordsMatch by returning empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(NO_RECORDS_RESPONSE),
      }),
    );

    const promise = fetchNewPapers("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;
    expect(ids).toEqual([]);
  });

  it("handles 503 with Retry-After", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ "Retry-After": "5" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE),
      });
    vi.stubGlobal("fetch", mockFetch);

    const promise = fetchNewPapers("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toEqual(["2401.15884", "2401.15885"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers(),
      }),
    );

    const promise = fetchNewPapers("2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;
    expect(ids).toEqual([]);
  });
});

describe("fetchNewPapersByCategory (deprecated)", () => {
  it("delegates to fetchNewPapers ignoring categories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE),
      }),
    );

    const promise = fetchNewPapersByCategory(["cs.AI", "cs.CL"], "2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toEqual(["2401.15884", "2401.15885"]);
    // Only 1 request (no per-category iteration)
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
