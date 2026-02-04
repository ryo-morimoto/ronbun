export type OaiPmhRecord = {
  arxivId: string;
  title: string;
  categories: string[];
};

/**
 * Fetch new papers from arXiv OAI-PMH API for given categories.
 * Uses ListRecords verb with oai_dc metadata prefix.
 * Handles resumption token pagination internally.
 * Respects arXiv's 3-second rate limit between requests.
 */
export async function fetchNewPapersByCategory(
  categories: string[],
  fromDate: string,  // YYYY-MM-DD
  untilDate: string, // YYYY-MM-DD
): Promise<string[]> {
  const arxivIds: string[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    let resumptionToken: string | null = null;
    let hasMore = true;

    while (hasMore) {
      let url: string;
      if (resumptionToken) {
        url = `https://export.arxiv.org/oai2?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
      } else {
        // arXiv OAI sets use ":" instead of "." for category format (e.g., cs:CL not cs.CL)
        const set = category.replace(".", ":");
        url = `https://export.arxiv.org/oai2?verb=ListRecords&metadataPrefix=oai_dc&from=${fromDate}&until=${untilDate}&set=${set}`;
      }

      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.error(`OAI-PMH request failed for ${category}: ${res.status}`);
        break;
      }

      const xml = await res.text();

      // Check for "noRecordsMatch" error
      if (xml.includes("noRecordsMatch")) {
        break;
      }

      // Extract arxiv IDs from record identifiers
      // OAI identifiers look like: oai:arXiv.org:2401.15884
      const idRe = /oai:arXiv\.org:(\d{4}\.\d{4,5})/g;
      let match: RegExpExecArray | null;
      while ((match = idRe.exec(xml)) !== null) {
        const id = match[1];
        if (!seen.has(id)) {
          seen.add(id);
          arxivIds.push(id);
        }
      }

      // Check for resumption token
      const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
      if (tokenMatch && tokenMatch[1].trim()) {
        resumptionToken = tokenMatch[1].trim();
        // arXiv requires 3-second wait between requests
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        hasMore = false;
      }
    }

    // Wait between categories too
    if (categories.indexOf(category) < categories.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  return arxivIds;
}
