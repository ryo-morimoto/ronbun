#!/usr/bin/env bun

const API_URL = process.env.RONBUN_API_URL ?? "http://localhost:8787";
const API_TOKEN = process.env.RONBUN_API_TOKEN ?? "";

const [command, ...args] = process.argv.slice(2);

async function callMcp(toolName: string, params: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: params },
    }),
  });
  return res.json();
}

async function main() {
switch (command) {
  case "search": {
    const query = args.join(" ");
    if (!query) { console.error("Usage: ronbun search <query>"); process.exit(1); }
    const result = await callMcp("search_papers", { query });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "ingest": {
    const arxivId = args[0];
    if (!arxivId) { console.error("Usage: ronbun ingest <arxivId>"); process.exit(1); }
    const result = await callMcp("ingest_paper", { arxivId });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "show": {
    const paperId = args[0];
    if (!paperId) { console.error("Usage: ronbun show <paperId|arxivId>"); process.exit(1); }
    const result = await callMcp("get_paper", { paperId });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "list": {
    const result = await callMcp("list_papers", {});
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "related": {
    const paperId = args[0];
    if (!paperId) { console.error("Usage: ronbun related <paperId>"); process.exit(1); }
    const result = await callMcp("find_related", { paperId });
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  default:
    console.log(`ronbun - a fast, modern browser for academic papers

Usage:
  ronbun search <query>         Search papers
  ronbun ingest <arxivId>       Ingest a paper
  ronbun show <paperId>         Show paper details
  ronbun list                   List papers
  ronbun related <paperId>      Find related papers

Environment:
  RONBUN_API_URL    API endpoint (default: http://localhost:8787)
  RONBUN_API_TOKEN  Bearer token for authentication`);
}
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

export {};
