import { bold, dim, red, green, yellow, truncate, titleWidth } from "./ansi.ts";

type PaperRow = {
  arxivId?: string;
  arxiv_id?: string;
  title?: string | null;
  categories?: string | string[] | null;
  publishedAt?: string | null;
  published_at?: string | null;
  status?: string;
  score?: number;
};

export function formatPaperRow(p: PaperRow): string {
  const id = p.arxivId || p.arxiv_id || "";
  const title = truncate(p.title || "(untitled)", titleWidth());
  const cats = Array.isArray(p.categories)
    ? p.categories[0] || ""
    : (p.categories || "").split(",")[0] || "";
  const year = (p.publishedAt || p.published_at || "").slice(0, 4);
  return `  ${dim(id)}  ${bold(title)}  ${dim(cats)}  ${dim(year)}`;
}

export function formatStatus(status: string): string {
  switch (status) {
    case "ready":
      return green(status);
    case "failed":
      return red(status);
    default:
      return yellow(status);
  }
}

export function formatDetail(paper: any): string {
  const lines: string[] = [];
  const p = paper.paper || paper;
  lines.push("");
  lines.push(`  ${bold(p.title || "(untitled)")}`);
  const id = p.arxiv_id || p.arxivId || "";
  const cats = Array.isArray(p.categories) ? p.categories.join(", ") : p.categories || "";
  const date = p.published_at || p.publishedAt || "";
  const status = p.status || "";
  lines.push(`  ${id} · ${cats} · ${date.slice(0, 10)} · ${formatStatus(status)}`);
  lines.push("");
  const authors = Array.isArray(p.authors) ? p.authors.join(", ") : p.authors || "";
  lines.push(`  Authors: ${authors}`);
  lines.push("");
  lines.push("  Abstract:");
  lines.push(`    ${p.abstract || "(none)"}`);

  if (paper.sections && paper.extractions && paper.citations) {
    lines.push("");
    lines.push(
      `  Sections: ${paper.sections.length} · Extractions: ${paper.extractions.length} · Citations: ${paper.citations.length}`,
    );
  }

  return lines.join("\n");
}

export function formatPreview(data: {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  bodyText: string | null;
}): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${bold(data.title)}  ${dim("[arXiv · preview]")}`);
  lines.push(`  ${data.arxivId} · ${dim(new Date().toISOString().slice(0, 10))}`);
  lines.push("");
  lines.push("  Abstract:");
  lines.push(`    ${data.abstract}`);
  if (data.bodyText) {
    lines.push("");
    lines.push("  Body:");
    lines.push(`    ${data.bodyText.slice(0, 2000).replace(/\n/g, "\n    ")}`);
    if (data.bodyText.length > 2000) {
      lines.push(`    ${dim("(showing first 10,000 characters)")}`);
    }
  } else {
    lines.push("");
    lines.push(`  Body: ${dim("(HTML not available)")}`);
  }
  return lines.join("\n");
}

export function formatStatusDetail(paper: any): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${dim(paper.arxiv_id || "")}  ${bold(paper.title || "(untitled)")}`);
  lines.push(`  Status: ${formatStatus(paper.status || "")}`);
  if (paper.error) {
    lines.push(`  Error: ${red(paper.error)}`);
  }
  if (paper.created_at) {
    lines.push(`  Queued: ${paper.created_at}`);
  }
  return lines.join("\n");
}
