export type OaiPmhRecord = {
  arxivId: string;
  title: string;
  categories: string[];
};

const OAI_PMH_ENDPOINT = "https://oaipmh.arxiv.org/oai";
const REQUEST_DELAY_MS = 3000;
const MAX_503_RETRIES = 3;

/**
 * Fetch all new papers from arXiv OAI-PMH API for a given date range.
 * Omits the `set` parameter to harvest all categories in a single pass.
 * Uses the `arXiv` metadata prefix for structured author/category data.
 * Handles resumption token pagination and 503 Retry-After flow control.
 */
export async function fetchNewPapers(
  fromDate: string, // YYYY-MM-DD
  untilDate: string, // YYYY-MM-DD
): Promise<string[]> {
  const arxivIds: string[] = [];
  const seen = new Set<string>();
  let resumptionToken: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const url = resumptionToken
      ? `${OAI_PMH_ENDPOINT}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`
      : `${OAI_PMH_ENDPOINT}?verb=ListRecords&metadataPrefix=arXiv&from=${fromDate}&until=${untilDate}`;

    const xml = await fetchWithRetry(url);
    if (!xml) break;

    if (xml.includes("noRecordsMatch")) break;

    const idRe = /oai:arXiv\.org:(\d{4}\.\d{4,5})/g;
    let match: RegExpExecArray | null;
    while ((match = idRe.exec(xml)) !== null) {
      const id = match[1];
      if (!seen.has(id)) {
        seen.add(id);
        arxivIds.push(id);
      }
    }

    const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
    if (tokenMatch && tokenMatch[1].trim()) {
      resumptionToken = tokenMatch[1].trim();
      await sleep(REQUEST_DELAY_MS);
    } else {
      hasMore = false;
    }
  }

  return arxivIds;
}

/**
 * @deprecated Use fetchNewPapers() instead. Kept for backward compatibility.
 */
export async function fetchNewPapersByCategory(
  _categories: string[],
  fromDate: string,
  untilDate: string,
): Promise<string[]> {
  return fetchNewPapers(fromDate, untilDate);
}

async function fetchWithRetry(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_503_RETRIES; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (res.ok) return res.text();

    if (res.status === 503) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "20", 10);
      console.log(
        `OAI-PMH 503, retrying after ${retryAfter}s (attempt ${attempt + 1}/${MAX_503_RETRIES})`,
      );
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 403) {
      console.error("OAI-PMH 403: rate limited or blocked. Stopping.");
      return null;
    }

    console.error(`OAI-PMH request failed: ${res.status}`);
    return null;
  }

  console.error("OAI-PMH max retries exceeded");
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
