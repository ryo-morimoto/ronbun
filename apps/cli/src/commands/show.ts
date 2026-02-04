import { defineCommand } from "citty";
import { createClient, handleResponse } from "../lib/client.ts";
import { formatDetail, formatPreview } from "../lib/format.ts";
import { confirmPrompt } from "../lib/prompt.ts";
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

      // Strip version if arXiv ID
      if (isArxivId(id)) {
        id = stripVersion(id);
      }

      // Try to fetch from local database
      const res = await client.api.papers[":id"].$get({
        param: { id },
      });

      if (res.ok) {
        const data = await handleResponse<any>(res);

        // Handle failed status
        if (data.paper?.status === "failed") {
          console.log(formatDetail(data));
          console.log("");
          const shouldReingest = await confirmPrompt("Paper ingestion failed. Re-ingest?");
          if (shouldReingest) {
            const ingestRes = await client.api.papers.ingest.$post({
              json: { arxivId: id },
            });
            await handleResponse<{ paperId: string }>(ingestRes);
            console.log("");
            console.log("  Re-ingestion queued. Check status with 'ronbun status <id>'.");
            console.log("");
          } else {
            console.log("");
          }
          return;
        }

        // Handle not-ready status
        if (data.paper?.status !== "ready") {
          console.log(formatDetail(data));
          console.log("");
          console.log(`  ${dim("Ingestion in progress. Check status with 'ronbun status " + id + "'.")}`);
          console.log("");
          return;
        }

        // Ready - show full details
        console.log(formatDetail(data));
        console.log("");
        return;
      }

      // 404 - check if it's an arXiv ID and offer to fetch
      if (res.status === 404 && isArxivId(id)) {
        const shouldFetch = await confirmPrompt("Paper not found locally. Fetch from arXiv?");
        if (!shouldFetch) {
          console.log("");
          return;
        }

        // Fetch preview and ingest in parallel
        const [previewRes, ingestRes] = await Promise.all([
          client.api.arxiv[":arxivId"].preview.$get({
            param: { arxivId: id },
          }),
          client.api.papers.ingest.$post({
            json: { arxivId: id },
          }),
        ]);

        const preview = await handleResponse<any>(previewRes);
        await handleResponse<{ paperId: string }>(ingestRes);

        console.log(formatPreview(preview));
        console.log("");
        console.log(`  ${dim("Ingesting in background. Check status with 'ronbun status " + id + "'.")}`);
        console.log("");
        return;
      }

      // Other error
      await handleResponse<any>(res);
    } catch (err) {
      console.error(`  ${red(`✗ ${err instanceof Error ? err.message : String(err)}`)}`);
      process.exit(1);
    }
  },
});
