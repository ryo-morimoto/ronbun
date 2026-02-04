import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatPaperRow } from "../lib/format.ts";
import { confirmPrompt } from "../lib/prompt.ts";
import { red } from "../lib/ansi.ts";

export default defineCommand({
  meta: {
    name: "list",
    description: "List papers with filters",
  },
  args: {
    status: {
      type: "string",
      description: "Filter by status (queued, metadata, parsed, extracted, ready, failed)",
    },
    category: {
      type: "string",
      description: "Filter by category",
    },
    year: {
      type: "string",
      description: "Filter by year",
    },
    sort: {
      type: "string",
      description: "Sort by field:order (e.g., publishedAt:desc)",
    },
    cursor: {
      type: "string",
      description: "Pagination cursor",
    },
    limit: {
      type: "string",
      description: "Maximum number of results",
      default: "20",
    },
  },
  async run({ args }) {
    try {
      const client = createClient();
      let cursor = args.cursor as string | undefined;

      const fetchPage = async (currentCursor?: string) => {
        const queryParams: Record<string, string> = {
          limit: args.limit as string,
        };

        if (args.status) queryParams.status = args.status as string;
        if (args.category) queryParams.category = args.category as string;
        if (args.year) queryParams.year = args.year as string;
        if (args.sort) queryParams.sort = args.sort as string;
        if (currentCursor) queryParams.cursor = currentCursor;

        const res = await client.api.papers.$get({
          query: queryParams,
        });

        return handleResponse<{ papers: any[]; cursor?: string; hasMore: boolean }>(res);
      };

      let hasMore = true;
      while (hasMore) {
        const data = await fetchPage(cursor);

        if (data.papers.length === 0) {
          console.log("");
          console.log("  No papers found.");
          console.log("");
          break;
        }

        console.log("");
        data.papers.forEach((p) => {
          console.log(formatPaperRow(p));
        });
        console.log("");

        hasMore = data.hasMore;
        cursor = data.cursor;

        if (hasMore) {
          const shouldContinue = await confirmPrompt("Load next page?");
          if (!shouldContinue) {
            break;
          }
        }
      }
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
