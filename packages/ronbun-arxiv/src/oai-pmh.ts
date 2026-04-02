export type OaiPmhRecord = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
  updatedAt: string;
};

const OAI_PMH_ENDPOINT = "https://oaipmh.arxiv.org/oai";
const REQUEST_DELAY_MS = 3000;
const MAX_503_RETRIES = 3;

/**
 * Fetch all new papers with full metadata from arXiv OAI-PMH.
 * Uses the `arXiv` metadata prefix for structured author/category data.
 * Omits the `set` parameter to harvest all categories in a single pass.
 */
export async function fetchNewPapersWithMetadata(
  fromDate: string,
  untilDate: string,
): Promise<OaiPmhRecord[]> {
  const records: OaiPmhRecord[] = [];
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

    for (const record of parseOaiRecords(xml)) {
      if (!seen.has(record.arxivId)) {
        seen.add(record.arxivId);
        records.push(record);
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

  return records;
}

/**
 * @deprecated Use fetchNewPapersWithMetadata() instead.
 */
export async function fetchNewPapers(fromDate: string, untilDate: string): Promise<string[]> {
  const records = await fetchNewPapersWithMetadata(fromDate, untilDate);
  return records.map((r) => r.arxivId);
}

/**
 * @deprecated Use fetchNewPapersWithMetadata() instead.
 */
export async function fetchNewPapersByCategory(
  _categories: string[],
  fromDate: string,
  untilDate: string,
): Promise<string[]> {
  return fetchNewPapers(fromDate, untilDate);
}

function parseOaiRecords(xml: string): OaiPmhRecord[] {
  const records: OaiPmhRecord[] = [];
  const recordRe = /<record>([\s\S]*?)<\/record>/g;
  let match: RegExpExecArray | null;

  while ((match = recordRe.exec(xml)) !== null) {
    const recordXml = match[1];
    const record = parseOneRecord(recordXml);
    if (record) records.push(record);
  }

  return records;
}

function parseOneRecord(xml: string): OaiPmhRecord | null {
  const idMatch = xml.match(/<id>(\d{4}\.\d{4,5})<\/id>/);
  if (!idMatch) return null;

  const arxivId = idMatch[1];
  const title = getTag("title", xml).replace(/\s+/g, " ");
  const abstract = getTag("abstract", xml).replace(/\s+/g, " ");
  const categoriesStr = getTag("categories", xml);
  const categories = categoriesStr ? categoriesStr.split(/\s+/).filter(Boolean) : [];
  const publishedAt = getTag("created", xml);
  const updatedAt = getTag("updated", xml) || publishedAt;

  const authors: string[] = [];
  const authorRe = /<author>([\s\S]*?)<\/author>/g;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorRe.exec(xml)) !== null) {
    const keyname = getTag("keyname", authorMatch[1]);
    const forenames = getTag("forenames", authorMatch[1]);
    if (keyname) {
      authors.push(forenames ? `${forenames} ${keyname}` : keyname);
    }
  }

  if (!title || !abstract) return null;

  return { arxivId, title, authors, abstract, categories, publishedAt, updatedAt };
}

function getTag(tag: string, source: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = source.match(re);
  return m ? m[1].trim() : "";
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
