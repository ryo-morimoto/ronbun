import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatPaperRow } from "../lib/format.ts";
import { confirmPrompt, selectPrompt } from "../lib/prompt.ts";
import { red } from "../lib/ansi.ts";

export default defineCommand({
  meta: {
    name: "search",
    description: "Search papers by query",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    category: {
      type: "string",
      description: "Filter by category",
    },
    "year-from": {
      type: "string",
      description: "Filter by year (from)",
    },
    "year-to": {
      type: "string",
      description: "Filter by year (to)",
    },
    limit: {
      type: "string",
      description: "Maximum number of results",
      default: "10",
    },
  },
  async run({ args }) {
    try {
      const client = createClient();
      const query = args.query as string;
      const category = args.category as string | undefined;
      const yearFrom = args["year-from"] as string | undefined;
      const yearTo = args["year-to"] as string | undefined;
      const limit = args.limit as string;

      // Search local database first
      const res = await client.api.papers.search.$post({
        json: {
          query,
          category,
          yearFrom: yearFrom ? parseInt(yearFrom, 10) : undefined,
          yearTo: yearTo ? parseInt(yearTo, 10) : undefined,
          limit: parseInt(limit, 10),
        },
      });

      const data = await handleResponse<{ papers: any[] }>(res);

      if (data.papers.length > 0) {
        console.log("");
        data.papers.forEach((p) => {
          console.log(formatPaperRow(p));
        });
        console.log("");
        return;
      }

      // No results found - offer to search arXiv
      const shouldSearchArxiv = await confirmPrompt("No results found locally. Search arXiv?");
      if (!shouldSearchArxiv) {
        console.log("");
        return;
      }

      // Search arXiv
      const arxivRes = await client.api.arxiv.search.$post({
        json: {
          query,
          category,
          yearFrom: yearFrom ? parseInt(yearFrom, 10) : undefined,
          yearTo: yearTo ? parseInt(yearTo, 10) : undefined,
          limit: parseInt(limit, 10),
        },
      });

      const arxivData = await handleResponse<{ papers: any[] }>(arxivRes);

      if (arxivData.papers.length === 0) {
        console.log("");
        console.log("  No results found on arXiv.");
        console.log("");
        return;
      }

      // Show numbered list
      console.log("");
      arxivData.papers.forEach((p, i) => {
        console.log(`${i + 1}. ${formatPaperRow(p)}`);
      });
      console.log("");

      // Prompt for selection
      const selection = await selectPrompt("Select papers to ingest (e.g., 1,3-5) or press Enter to skip");
      if (selection === "skip" || selection === "") {
        console.log("");
        return;
      }

      // Parse selection
      const selectedIndices = new Set<number>();
      const parts = selection.split(",").map((s) => s.trim());
      for (const part of parts) {
        if (part.includes("-")) {
          const [start, end] = part.split("-").map((s) => parseInt(s.trim(), 10));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) {
              if (i >= 1 && i <= arxivData.papers.length) {
                selectedIndices.add(i - 1);
              }
            }
          }
        } else {
          const idx = parseInt(part, 10);
          if (!isNaN(idx) && idx >= 1 && idx <= arxivData.papers.length) {
            selectedIndices.add(idx - 1);
          }
        }
      }

      if (selectedIndices.size === 0) {
        console.log("");
        return;
      }

      const selectedPapers = Array.from(selectedIndices)
        .sort((a, b) => a - b)
        .map((i) => arxivData.papers[i]);
      const arxivIds = selectedPapers.map((p) => p.arxivId || p.arxiv_id);

      // Batch ingest
      const ingestRes = await client.api.papers["batch-ingest"].$post({
        json: { arxivIds },
      });

      await handleResponse<{ queued: number }>(ingestRes);
      console.log("");
      console.log(`  Queued ${arxivIds.length} paper(s) for ingestion.`);
      console.log("");
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
