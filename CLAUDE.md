# CLAUDE.md

## Project

ronbun -- a fast, modern browser for academic papers with MCP server support.

## Tech

- TypeScript on Cloudflare Workers
- Hono (HTTP framework)
- D1 (SQLite), R2 (object storage), Vectorize (vector search), Queues (async processing)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Zod for schema validation
- Vitest + `@cloudflare/vitest-pool-workers` for testing

## Structure

```
src/
  index.ts          -- Hono app, MCP server setup, HTTP endpoints
  types.ts          -- TypeScript type definitions (Env bindings)
  schemas.ts        -- Zod validation schemas
  tools/
    ingest.ts       -- Paper ingestion (single + batch)
    search.ts       -- Hybrid search (FTS + vector), extraction search
    papers.ts       -- Paper retrieval, listing, related papers
  queue/
    consumer.ts     -- Queue consumer: metadata -> content -> extraction -> embedding
  lib/
    arxiv.ts        -- arXiv API integration, HTML/PDF parsing
    id.ts           -- UUID generation
migrations/
  0001_init.sql     -- Database schema (papers, sections, extractions, citations, entity_links, FTS tables)
test/
  *.test.ts         -- Test files
```

## Commands

```bash
bun run dev            # Local dev server
bun run test           # Run tests
bun run typecheck      # Type check
bun run db:migrate:local   # Apply migrations locally
bun run deploy         # Deploy to Cloudflare
```

## Conventions

- Path alias: `@/*` maps to `./src/*`
- All IDs use `crypto.randomUUID()`
- Paper ingestion is async via Cloudflare Queues (4-step pipeline: metadata -> content -> extraction -> embedding)
- Paper status lifecycle: queued -> metadata -> parsed -> extracted -> ready (or failed)
- Hybrid search uses Reciprocal Rank Fusion (FTS + vector)
- Bearer token auth on `/mcp` and `/status/:arxivId` endpoints
