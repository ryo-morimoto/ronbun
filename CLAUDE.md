# CLAUDE.md

## Project

ronbun -- a fast, modern browser for academic papers with MCP server support.

## Tech

- TypeScript on Cloudflare Workers
- Turborepo + bun workspaces monorepo
- Hono (HTTP framework)
- D1 (SQLite), R2 (object storage), Vectorize (vector search), Queues (async processing)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Zod for schema validation
- Vitest + `@cloudflare/vitest-pool-workers` for testing

## Structure

```
apps/
  api/                -- Cloudflare Worker: REST + MCP + Cron (@ronbun/server)
    src/index.ts      -- Hono app, AppType export, MCP tools, queue/cron handlers
    src/env.ts        -- Env type with Cloudflare bindings
    src/routes/       -- REST routes (papers, extractions, arxiv)
    src/cron.ts       -- Cron trigger for daily arXiv ingestion via OAI-PMH
    test/             -- D1 integration tests
    wrangler.toml     -- Cloudflare Worker config
  cli/                -- Terminal tool using citty + hono/client (@ronbun/cli)
    src/commands/     -- search, show, list, related, extractions, status
    src/lib/          -- client, format, ansi, prompt, arxiv-id
  web/                -- TanStack Start frontend on Cloudflare Pages (placeholder)

packages/
  ronbun-types/       -- Shared TypeScript types (PaperRow, SectionRow, etc.)
  ronbun-schemas/     -- Zod validation schemas
  ronbun-arxiv/       -- arXiv API client, HTML/PDF parsing, OAI-PMH, ID generation
  ronbun-database/    -- D1 database operations (papers, sections, extractions, citations, entity-links)
  ronbun-storage/     -- R2 object storage wrappers
  ronbun-vector/      -- Vectorize embedding & semantic search
  ronbun-api/         -- Business logic layer orchestrating all packages via DI (RonbunContext)

migrations/
  0001_init.sql       -- Database schema
```

## Commands

```bash
bun run typecheck      # Typecheck all packages (via turbo)
bun run test           # Run all tests (via turbo)
bun run dev            # Dev all apps (via turbo)
bun run db:migrate:local   # Apply migrations locally
```

Per-app commands:
```bash
cd apps/api && bun run dev       # API server dev
cd apps/api && bun run test      # API integration tests
cd apps/api && bun run deploy    # Deploy to Cloudflare
cd apps/cli && bun run dev       # Run CLI locally
```

## Conventions

- Monorepo: `@ronbun/*` namespace, `workspace:*` protocol for internal deps
- Internal packages use JIT TypeScript (export .ts directly, no build step)
- Dependency Injection: Cloudflare bindings passed via `RonbunContext` type
- `@ronbun/api` returns plain data objects, NOT MCP-formatted responses
- All IDs use `crypto.randomUUID()`
- Paper ingestion is async via Cloudflare Queues (4-step pipeline: metadata -> content -> extraction -> embedding)
- Paper status lifecycle: queued -> metadata -> parsed -> extracted -> ready (or failed)
- Hybrid search uses Reciprocal Rank Fusion (FTS + vector)
- Bearer token auth on `/api/*` and `/mcp` endpoints
- REST routes use Hono method chaining for AppType inference (hono/client)
- CLI uses citty for commands, hono/client for type-safe API calls
- Cron trigger ingests daily arXiv papers via OAI-PMH API
