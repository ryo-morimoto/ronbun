import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchNewPapersByCategory } from "../src/oai-pmh.ts";

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
    <resumptionToken cursor="0" completeListSize="100">token123</resumptionToken>
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
  // Mock setTimeout to avoid waiting 3 seconds in tests
  vi.useFakeTimers();
});

describe("fetchNewPapersByCategory", () => {
  it("fetches papers for a single category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE),
      }),
    );

    const promise = fetchNewPapersByCategory(["cs.AI"], "2024-01-01", "2024-01-31");
    vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toEqual(["2401.15884", "2401.15885"]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("set=cs:AI"), expect.anything());
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

    const promise = fetchNewPapersByCategory(["cs.AI"], "2024-01-01", "2024-01-31");
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

    const promise = fetchNewPapersByCategory(["cs.AI"], "2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;
    expect(ids).toEqual([]);
  });

  it("handles HTTP error by breaking category loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const promise = fetchNewPapersByCategory(["cs.AI"], "2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;
    expect(ids).toEqual([]);
  });

  it("deduplicates across categories", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SAMPLE_OAI_RESPONSE), // Same IDs
      });
    vi.stubGlobal("fetch", mockFetch);

    const promise = fetchNewPapersByCategory(["cs.AI", "cs.CL"], "2024-01-01", "2024-01-31");
    await vi.runAllTimersAsync();
    const ids = await promise;

    // Should only contain unique IDs
    expect(ids).toEqual(["2401.15884", "2401.15885"]);
  });
});
