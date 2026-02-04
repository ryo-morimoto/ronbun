import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { red, dim, bold, truncate, titleWidth } from "../lib/ansi.ts";

export default defineCommand({
  meta: {
    name: "extractions",
    description: "Search extracted knowledge",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    type: {
      type: "string",
      description: "Filter by extraction type (definition, method, dataset, finding, claim)",
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
      const type = args.type as string | undefined;
      const limit = args.limit as string;

      const res = await client.api.extractions.search.$post({
        json: {
          query,
          type,
          limit: parseInt(limit, 10),
        },
      });

      const data = await handleResponse<{ extractions: any[] }>(res);

      if (data.extractions.length === 0) {
        console.log("");
        console.log("  No extractions found.");
        console.log("");
        return;
      }

      console.log("");
      data.extractions.forEach((e) => {
        const extractionType = e.type || "";
        const detail = e.detail || e.key_detail || "";
        const paperTitle = e.paper_title || e.paperTitle || "(untitled)";
        const arxivId = e.arxiv_id || e.arxivId || "";

        console.log(`  ${dim(`[${extractionType}]`)}  ${bold(truncate(detail, titleWidth()))}`);
        console.log(`    ${dim(arxivId)}  ${truncate(paperTitle, titleWidth() - 20)}`);
      });
      console.log("");
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
