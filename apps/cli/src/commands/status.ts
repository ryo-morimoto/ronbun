import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatStatusDetail } from "../lib/format.ts";
import { red } from "../lib/ansi.ts";
import { isArxivId, stripVersion } from "../lib/arxiv-id.ts";

export default defineCommand({
  meta: {
    name: "status",
    description: "Check paper ingestion status",
  },
  args: {
    id: {
      type: "positional",
      description: "Paper ID (arXiv ID)",
      required: true,
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

      const res = await client.api.papers[":id"].status.$get({
        param: { id },
      });

      const data = await handleResponse<any>(res);

      console.log(formatStatusDetail(data));
      console.log("");
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
