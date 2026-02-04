type ArxivMetadata = {
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

export async function fetchArxivHtml(arxivId: string): Promise<string | null> {
  const url = `https://ar5iv.labs.arxiv.org/html/${arxivId}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return null;
  return res.text();
}

export async function fetchArxivPdf(arxivId: string): Promise<ArrayBuffer | null> {
  const url = `https://arxiv.org/pdf/${arxivId}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  return res.arrayBuffer();
}

export type ParsedSection = {
  heading: string;
  level: number;
  content: string;
  position: number;
};

export type ParsedReference = {
  arxivId: string | null;
  doi: string | null;
  title: string;
};

export type ParsedContent = {
  sections: ParsedSection[];
  references: ParsedReference[];
};

export function parseHtmlContent(html: string): ParsedContent {
  const sections: ParsedSection[] = [];
  const references: ParsedReference[] = [];

  // Extract sections by heading tags
  const headingRe = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  const headings: { level: number; title: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(html)) !== null) {
    const level = parseInt(match[1][1]);
    const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    headings.push({ level, title, index: match.index + match[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index - 200 : html.length;
    const rawContent = html.slice(start, end);
    const textContent = rawContent
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    if (textContent.length > 20) {
      sections.push({
        heading: headings[i].title,
        level: headings[i].level,
        content: textContent,
        position: i,
      });
    }
  }

  // If no sections found, treat entire body as one section
  if (sections.length === 0) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyText = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (bodyText.length > 20) {
      sections.push({
        heading: "Full Text",
        level: 1,
        content: bodyText,
        position: 0,
      });
    }
  }

  // Extract references - look for arxiv IDs and DOIs in reference sections
  const arxivIdRe = /(\d{4}\.\d{4,5})(v\d+)?/g;
  const doiRe = /10\.\d{4,}\/[^\s<>"]+/g;
  const refSection = html.match(/<section[^>]*(?:id|class)="[^"]*(?:bib|ref)[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  const refHtml = refSection ? refSection[1] : "";

  if (refHtml) {
    // Extract individual reference items
    const refItems = refHtml.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    for (const item of refItems) {
      const textItem = item.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const arxivMatch = item.match(arxivIdRe);
      const doiMatch = item.match(doiRe);
      references.push({
        arxivId: arxivMatch ? arxivMatch[0] : null,
        doi: doiMatch ? doiMatch[0] : null,
        title: textItem.slice(0, 300),
      });
    }
  }

  return { sections, references };
}

export function parsePdfText(text: string): ParsedContent {
  const sections: ParsedSection[] = [];
  const lines = text.split("\n");

  // Heuristic section detection for PDF text
  const sectionRe = /^(\d+\.?\s+|[A-Z]\.\s+|Abstract|Introduction|Conclusion|References|Acknowledgments)/;
  let currentHeading = "Abstract";
  let currentContent: string[] = [];
  let position = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (sectionRe.test(trimmed) && trimmed.length < 100) {
      if (currentContent.length > 0) {
        const content = currentContent.join(" ").trim();
        if (content.length > 20) {
          sections.push({
            heading: currentHeading,
            level: 1,
            content,
            position: position++,
          });
        }
      }
      currentHeading = trimmed;
      currentContent = [];
    } else if (trimmed) {
      currentContent.push(trimmed);
    }
  }

  // Push last section
  if (currentContent.length > 0) {
    const content = currentContent.join(" ").trim();
    if (content.length > 20) {
      sections.push({
        heading: currentHeading,
        level: 1,
        content,
        position: position++,
      });
    }
  }

  return { sections, references: [] };
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
