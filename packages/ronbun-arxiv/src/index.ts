export { fetchArxivMetadata, searchArxivPapers, searchArxivPapersWithMetadata } from "./api.ts";
export type { ArxivMetadata, ArxivSearchResult } from "./api.ts";

export { fetchArxivHtml, fetchArxivPdf, parseHtmlContent, parsePdfText } from "./parser.ts";
export type { ParsedSection, ParsedReference, ParsedContent } from "./parser.ts";

export { generateId } from "./id.ts";

export { fetchNewPapersByCategory } from "./oai-pmh.ts";
export type { OaiPmhRecord } from "./oai-pmh.ts";
