import { z } from "zod";

export const arxivIdSchema = z
  .string()
  .regex(/^\d{4}\.\d{4,5}(v\d+)?$/, "Invalid arxiv ID format (e.g. 2401.15884)")
  .transform((id) => id.replace(/v\d+$/, ""));

export const ingestPaperInput = z.object({
  arxivId: arxivIdSchema,
});

export const batchIngestInput = z.object({
  arxivIds: z.array(arxivIdSchema).min(1).max(50).optional(),
  searchQuery: z.string().min(1).max(200).optional(),
}).refine((data) => data.arxivIds || data.searchQuery, {
  message: "Either arxivIds or searchQuery must be provided",
});

export const searchPapersInput = z.object({
  query: z.string().min(1).max(500),
  category: z.string().optional(),
  yearFrom: z.number().int().min(1990).max(2030).optional(),
  yearTo: z.number().int().min(1990).max(2030).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getPaperInput = z.object({
  paperId: z.string().min(1),
});

export const listPapersInput = z.object({
  category: z.string().optional(),
  year: z.number().int().min(1990).max(2030).optional(),
  status: z.enum(["queued", "metadata", "parsed", "extracted", "ready", "failed"]).optional(),
  sortBy: z.enum(["published_at", "created_at", "title"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const findRelatedInput = z.object({
  paperId: z.string().min(1),
  linkTypes: z.array(z.enum(["citation", "cited_by", "shared_method", "shared_dataset", "shared_author"])).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const searchExtractionsInput = z.object({
  query: z.string().min(1).max(500),
  type: z.enum(["method", "dataset", "baseline", "metric", "result", "contribution", "limitation"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const queueMessageSchema = z.object({
  paperId: z.string(),
  arxivId: z.string(),
  step: z.enum(["metadata", "content", "extraction", "embedding"]),
  retryCount: z.number().int().optional(),
});
