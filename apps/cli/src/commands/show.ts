import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatDetail, formatPreview } from "../lib/format.ts";
import { red, dim } from "../lib/ansi.ts";
import { isArxivId, stripVersion } from "../lib/arxiv-id.ts";

export default defineCommand({
  meta: {
    name: "show",
    description: "Show paper details",
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

      if (isArxivId(id)) {
        id = stripVersion(id);
      }

      const res = await client.api.papers[":id"].$get({
        param: { id },
      });

      if (res.ok) {
        const data = await handleResponse<any>(res);

        if (data.paper?.status === "failed") {
          console.log(formatDetail(data));
          console.log("");
          console.log(`  ${dim("Paper ingestion failed. It will be retried automatically.")}`);
          console.log("");
          return;
        }

        if (data.paper?.status !== "ready") {
          console.log(formatDetail(data));
          console.log("");
          console.log(
            `  ${dim("Ingestion in progress. Check status with 'ronbun status " + id + "'.")}`,
          );
          console.log("");
          return;
        }

        console.log(formatDetail(data));
        console.log("");
        return;
      }

      if (res.status === 404 && isArxivId(id)) {
        const previewRes = await client.api.arxiv[":arxivId"].preview.$get({
          param: { arxivId: id },
        });
        const preview = await handleResponse<any>(previewRes);
        console.log(formatPreview(preview));
        console.log("");
        console.log(
          `  ${dim("Paper not ingested yet. It will be available after the next cron run.")}`,
        );
        console.log("");
        return;
      }

      await handleResponse<any>(res);
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
