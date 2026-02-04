import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatPaperRow } from "../lib/format.ts";
import { red, dim } from "../lib/ansi.ts";
import { isArxivId, stripVersion } from "../lib/arxiv-id.ts";

export default defineCommand({
  meta: {
    name: "related",
    description: "Find related papers",
  },
  args: {
    id: {
      type: "positional",
      description: "Paper ID (arXiv ID)",
      required: true,
    },
    type: {
      type: "string",
      description: "Link type filter (citation, reference, semantic)",
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
      let id = args.id as string;

      // Strip version if arXiv ID
      if (isArxivId(id)) {
        id = stripVersion(id);
      }

      const queryParams: Record<string, string> = {
        limit: args.limit as string,
      };

      if (args.type) {
        queryParams.type = args.type as string;
      }

      const res = await client.api.papers[":id"].related.$get({
        param: { id },
        query: queryParams,
      } as any);

      const data = await handleResponse<{ papers: any[] }>(res);

      if (data.papers.length === 0) {
        console.log("");
        console.log("  No related papers found.");
        console.log("");
        return;
      }

      console.log("");
      data.papers.forEach((p) => {
        const linkType = p.linkType || p.link_type || "";
        const row = formatPaperRow(p);
        if (linkType) {
          console.log(`${row}  ${dim(`[${linkType}]`)}`);
        } else {
          console.log(row);
        }
      });
      console.log("");
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
