export type PaperStatus = "metadata" | "ready" | "failed";

export type PaperRow = {
  id: string;
  arxiv_id: string;
  title: string | null;
  authors: string | null;
  abstract: string | null;
  categories: string | null;
  published_at: string | null;
  updated_at: string | null;
  status: PaperStatus;
  error: string | null;
  created_at: string;
  ingested_at: string | null;
};

export type ParsedPaper = Omit<PaperRow, "authors" | "categories"> & {
  authors: string[];
  categories: string[];
};

export type SectionRow = {
  id: string;
  paper_id: string;
  heading: string;
  level: number;
  content: string;
  position: number;
  created_at: string;
};

export type CitationRow = {
  id: string;
  source_paper_id: string;
  target_paper_id: string | null;
  target_arxiv_id: string | null;
  target_doi: string | null;
  target_title: string | null;
  created_at: string;
};

export type EntityLinkRow = {
  id: string;
  paper_id: string;
  entity_type: "author";
  entity_name: string;
  created_at: string;
};

export type QueueMessage = {
  paperId: string;
  arxivId: string;
};
