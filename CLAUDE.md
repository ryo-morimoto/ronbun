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
  mcp/                -- Cloudflare Worker MCP server (Hono + MCP SDK)
    src/index.ts      -- Hono app, MCP tool registrations, queue handler
    src/env.ts        -- Env type with Cloudflare bindings
    test/             -- D1 integration tests
    wrangler.toml     -- Cloudflare Worker config
  web/                -- TanStack Start frontend on Cloudflare Pages (placeholder)
  cli/                -- Terminal tool for paper operations via MCP API

packages/
  ronbun-types/       -- Shared TypeScript types (PaperRow, SectionRow, etc.)
  ronbun-schemas/     -- Zod validation schemas
  ronbun-arxiv/       -- arXiv API client, HTML/PDF parsing, ID generation
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
cd apps/mcp && bun run dev       # MCP server dev
cd apps/mcp && bun run test      # MCP integration tests
cd apps/mcp && bun run deploy    # Deploy to Cloudflare
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
- Bearer token auth on `/mcp` and `/status/:arxivId` endpoints
