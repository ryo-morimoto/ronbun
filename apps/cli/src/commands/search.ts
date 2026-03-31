import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatPaperRow } from "../lib/format.ts";
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

      if (data.papers.length === 0) {
        console.log("");
        console.log("  No results found.");
        console.log("");
        return;
      }

      console.log("");
      data.papers.forEach((p) => {
        console.log(formatPaperRow(p));
      });
      console.log("");
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
