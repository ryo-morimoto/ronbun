import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchNewPapers, fetchNewPapersByCategory } from "../src/oai-pmh.ts";

const SAMPLE_OAI_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15884</identifier></header>
    </record>
    <record>
      <header><identifier>oai:arXiv.org:2401.15885</identifier></header>
    </record>
  </ListRecords>
</OAI-PMH>`;

const SAMPLE_OAI_WITH_RESUMPTION = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15886</identifier></header>
    </record>
    <resumptionToken>token123</resumptionToken>
  </ListRecords>
</OAI-PMH>`;

const SAMPLE_OAI_PAGE2 = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.15887</identifier></header>
    </record>
  </ListRecords>
</OAI-PMH>`;

const NO_RECORDS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH>
  <error code="noRecordsMatch">No records match the request</error>
</OAI-PMH>`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
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
