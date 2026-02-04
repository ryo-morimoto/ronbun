# ronbun

A fast, modern browser for academic papers. Available as both a web app and an MCP server.

## Features

- Ingest arXiv papers (single or batch)
- Hybrid search (semantic + keyword) across indexed papers
- AI-powered structured knowledge extraction (methods, datasets, results, etc.)
- Citation graph and related paper discovery
- MCP protocol support for AI assistant integration

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Vector Search**: Cloudflare Vectorize
- **AI**: Cloudflare AI (embeddings + LLM extraction)
- **Queue**: Cloudflare Queues (async paper ingestion)

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run dev

# Run tests
bun run test

# Type check
bun run typecheck

# Apply database migrations (local)
bun run db:migrate:local
```

## Environment Variables

Copy `.dev.vars.example` to `.dev.vars` and fill in the required values.

## License

MIT
