# ronbun

A fast, modern browser for academic papers. Available as an MCP server, web app, and CLI.

## Features

- Ingest arXiv papers (single or batch via Cloudflare Queues)
- Hybrid search (semantic + keyword) with Reciprocal Rank Fusion
- AI-powered structured knowledge extraction (methods, datasets, results, etc.)
- Citation graph and related paper discovery
- MCP protocol support for AI assistant integration
- CLI for terminal-based paper operations

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Monorepo**: Turborepo + bun workspaces
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Vector Search**: Cloudflare Vectorize
- **AI**: Cloudflare AI (embeddings + LLM extraction)
- **Queue**: Cloudflare Queues (async paper ingestion)
- **Validation**: Zod
- **Testing**: Vitest + `@cloudflare/vitest-pool-workers`

## Project Structure

```
apps/
  api/          REST + MCP + Cron server on Cloudflare Workers (@ronbun/server)
  cli/          Terminal tool using citty + hono/client (@ronbun/cli)
  web/          Web frontend on Cloudflare Pages (TanStack Start) [WIP]

packages/
  ronbun-types/      Shared TypeScript types
  ronbun-schemas/    Zod validation schemas
  ronbun-arxiv/      arXiv API client, HTML/PDF parsing, OAI-PMH
  ronbun-database/   D1 database operations
  ronbun-storage/    R2 object storage wrappers
  ronbun-vector/     Vectorize embedding & semantic search
  ronbun-api/        Business logic layer (DI via RonbunContext)

migrations/
  0001_init.sql      Database schema
```

## Development

```bash
# Install dependencies
bun install

# Typecheck all packages
bun run typecheck

# Run all tests
bun run test

# Dev all apps
bun run dev

# Apply database migrations (local)
bun run db:migrate:local
```

Per-app commands:

```bash
cd apps/api && bun run dev       # API server dev
cd apps/api && bun run test      # API integration tests
cd apps/api && bun run deploy    # Deploy to Cloudflare
cd apps/cli && bun run dev       # Run CLI locally
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `ingest_paper` | Ingest a single arXiv paper by ID |
| `batch_ingest` | Ingest multiple papers by IDs or search query |
| `search_papers` | Hybrid semantic + keyword search |
| `search_extractions` | Search extracted knowledge across papers |
| `get_paper` | Get full paper details with sections, extractions, citations |
| `list_papers` | List papers with filtering and pagination |
| `find_related` | Find related papers via citations, shared methods/datasets/authors |

## CLI Commands

```bash
ronbun search <query> [--category <cat>] [--year-from <y>] [--year-to <y>] [--limit <n>]
ronbun show <paperId|arxivId>
ronbun list [--status <s>] [--category <c>] [--year <y>] [--sort <field:order>] [--limit <n>]
ronbun related <paperId> [--type <t>] [--limit <n>]
ronbun extractions <query> [--type <t>] [--limit <n>]
ronbun status <arxivId>
```

## Roadmap

- [x] Monorepo migration (Turborepo + bun workspaces)
- [x] Shared domain packages (`@ronbun/*`)
- [x] REST + MCP + Cron server (`apps/api`)
- [x] CLI tool with citty + hono/client (`apps/cli`)
- [x] Daily arXiv ingestion via OAI-PMH Cron trigger
- [ ] Web frontend (`apps/web` -- TanStack Start on Cloudflare Pages)
- [ ] Agent skills for MCP tool orchestration

## Environment Variables

Copy `.dev.vars.example` to `.dev.vars` in `apps/api/` and fill in the required values.

## License

MIT
