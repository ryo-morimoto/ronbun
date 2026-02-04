export type PaperStatus = "queued" | "metadata" | "parsed" | "extracted" | "ready" | "failed";

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

export type SectionRow = {
  id: string;
  paper_id: string;
  heading: string;
  level: number;
  content: string;
  position: number;
  created_at: string;
};

export type ExtractionRow = {
  id: string;
  paper_id: string;
  type: ExtractionType;
  name: string;
  detail: string | null;
  section_id: string | null;
  created_at: string;
};

export type ExtractionType =
  | "method"
  | "dataset"
  | "baseline"
  | "metric"
  | "result"
  | "contribution"
  | "limitation";

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
  entity_type: "method" | "dataset" | "author";
  entity_name: string;
  created_at: string;
};

export type QueueStep = "metadata" | "content" | "extraction" | "embedding";

export type QueueMessage = {
  paperId: string;
  arxivId: string;
  step: QueueStep;
  retryCount?: number;
};
