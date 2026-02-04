export type ArxivMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
  updatedAt: string;
};

export async function fetchArxivMetadata(arxivId: string): Promise<ArxivMetadata> {
  const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`arxiv API returned ${res.status}`);
  }
  const xml = await res.text();
  return parseArxivXml(xml, arxivId);
}

function parseArxivXml(xml: string, arxivId: string): ArxivMetadata {
  const getTag = (tag: string, source: string): string => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
    const m = source.match(re);
    return m ? m[1].trim() : "";
  };

  const getAllTags = (tag: string, source: string): string[] => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      results.push(m[1].trim());
    }
    return results;
  };

  const entry = getTag("entry", xml);
  if (!entry) {
    throw new Error(`No entry found for arxiv ID ${arxivId}`);
  }

  const title = getTag("title", entry).replace(/\s+/g, " ");
  const abstract = getTag("summary", entry).replace(/\s+/g, " ");
  const publishedAt = getTag("published", entry);
  const updatedAt = getTag("updated", entry);

  const authorBlocks = getAllTags("author", entry);
  const authors = authorBlocks.map((block) => getTag("name", block));

  const categoryMatches = entry.match(/category[^>]*term="([^"]+)"/g) || [];
  const categories = categoryMatches.map((c) => {
    const m = c.match(/term="([^"]+)"/);
    return m ? m[1] : "";
  }).filter(Boolean);

  return { title, authors, abstract, categories, publishedAt, updatedAt };
}

export async function searchArxivPapers(query: string, maxResults: number = 20): Promise<string[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`arxiv search API returned ${res.status}`);
  }
  const xml = await res.text();

  const ids: string[] = [];
  const idRe = /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(xml)) !== null) {
    if (!ids.includes(m[1])) {
      ids.push(m[1]);
    }
  }
  return ids;
}

export type ArxivSearchResult = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
};

export async function searchArxivPapersWithMetadata(
  query: string,
  maxResults: number = 20,
): Promise<ArxivSearchResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`arxiv search API returned ${res.status}`);
  }
  const xml = await res.text();
  return parseArxivSearchResults(xml);
}

function parseArxivSearchResults(xml: string): ArxivSearchResult[] {
  const getTag = (tag: string, source: string): string => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
    const m = source.match(re);
    return m ? m[1].trim() : "";
  };

  const getAllTags = (tag: string, source: string): string[] => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      results.push(m[1].trim());
    }
    return results;
  };

  const entries = getAllTags("entry", xml);
  const results: ArxivSearchResult[] = [];

  for (const entry of entries) {
    const title = getTag("title", entry).replace(/\s+/g, " ");
    const abstract = getTag("summary", entry).replace(/\s+/g, " ");
    const publishedAt = getTag("published", entry);

    const authorBlocks = getAllTags("author", entry);
    const authors = authorBlocks.map((block) => getTag("name", block));

    const categoryMatches = entry.match(/category[^>]*term="([^"]+)"/g) || [];
    const categories = categoryMatches.map((c) => {
      const m = c.match(/term="([^"]+)"/);
      return m ? m[1] : "";
    }).filter(Boolean);

    const idTag = getTag("id", entry);
    const idMatch = idTag.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/);
    const arxivId = idMatch ? idMatch[1] : "";

    if (arxivId && title && abstract) {
      results.push({ arxivId, title, authors, abstract, categories, publishedAt });
    }
  }

  return results;
}
