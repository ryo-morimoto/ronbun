export { fetchArxivMetadata, searchArxivPapers, searchArxivPapersWithMetadata } from "./api.ts";
export type { ArxivMetadata, ArxivSearchResult } from "./api.ts";

export {
  fetchArxivHtml,
  fetchArxivNativeHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
  extractPdfText,
} from "./parser.ts";
export type { ParsedSection, ParsedReference, ParsedContent } from "./parser.ts";

export { generateId } from "./id.ts";

export { fetchNewPapersWithMetadata, fetchNewPapers, fetchNewPapersByCategory } from "./oai-pmh.ts";
export type { OaiPmhRecord } from "./oai-pmh.ts";
