# CLAUDE.md

## Project

ronbun -- a fast, modern browser for academic papers.

## Principles

### External API Respect

ronbun stands on the shoulders of giants (arXiv, Semantic Scholar, etc.). All external API access MUST:

- Respect documented rate limits (arXiv: 3s between requests, OAI-PMH: handle 503 + Retry-After)
- Handle 429/503 with exponential backoff or Retry-After, never retry blindly
- Stop immediately on 403 (IP ban)
- Set a descriptive User-Agent where possible
- Prefer bulk endpoints (OAI-PMH without set param) over per-item requests
- Never circumvent rate limits by distributing across IPs

When in doubt, be MORE conservative than the documented limits.

### Cost-Conscious Architecture

Follow the tiered processing pattern: index cheaply and broadly, extract expensively and selectively.

- Embed abstracts at ingestion (Tier 0, ~$5/month)
- Full text parsing at ingestion (Tier 0, arXiv HTML/PDF)
- Section embedding and LLM extraction are NOT used (removed for cost reasons)
- FTS + abstract vector hybrid search is sufficient for paper discovery

## Tech

- TypeScript on Cloudflare Workers
- Turborepo + bun workspaces monorepo
- Hono (HTTP framework)
- D1 (SQLite), R2 (object storage), Vectorize (vector search), Queues (async processing)
- Zod for schema validation
- Vitest + `@cloudflare/vitest-pool-workers` for testing
- pdf-oxide-wasm (Rust WASM) for PDF text extraction

## Structure

```
apps/
  web/                -- TanStack Start on Cloudflare Workers (@ronbun/web)
    src/server.ts     -- Worker entrypoint: fetch, queue, scheduled handlers
    src/server/api/   -- Hono REST routes (papers, arxiv)
    src/server/cron.ts -- Cron: OAI-PMH bulk harvest + batch insert + queue
    src/routes/       -- TanStack Start pages (search, papers, paper detail, arxiv)
    wrangler.toml     -- Dev config (bindings in env.production / env.preview)
    wrangler.deploy.toml -- Deploy config (built entrypoint)
  cli/                -- Terminal tool using citty + hono/client (@ronbun/cli)
    src/commands/     -- search, show, list, related, status (read-only)

packages/
  ronbun-types/       -- Shared TypeScript types (PaperRow, ParsedPaper, etc.)
  ronbun-schemas/     -- Zod validation schemas
  ronbun-arxiv/       -- arXiv API client, HTML/PDF parsing, OAI-PMH, ID generation
  ronbun-database/    -- D1 database operations (papers, sections, citations, entity-links)
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
```

Per-app commands:

```bash
cd apps/web && bun run dev       # Dev server
cd apps/web && bun run test      # Integration tests
cd apps/web && bun run build     # Build for deploy
cd apps/web && bunx wrangler deploy --env production --config wrangler.deploy.toml  # Deploy
cd apps/cli && bun run dev       # Run CLI locally
```

## Conventions

- Monorepo: `@ronbun/*` namespace, `workspace:*` protocol for internal deps
- Internal packages use JIT TypeScript (export .ts directly, no build step)
- Dependency Injection: Cloudflare bindings passed via `RonbunContext` type
- `@ronbun/api` returns plain data objects
- All IDs use `crypto.randomUUID()`
- Paper ingestion: cron fetches OAI-PMH metadata → batch insert + batch embed → DO alarm scheduler → Queue content step
- Paper status lifecycle: metadata → ready (or failed)
- Cron: OAI-PMH with arXiv prefix returns full metadata. No individual arXiv API calls
- DO alarm scheduler (ArxivFetchScheduler): rate-controls content fetch at 3s intervals
- Content step: fetch HTML/PDF (3-tier fallback: ar5iv → native HTML → pdf-oxide-wasm) + parse sections/citations + mark ready
- ar5iv is a static dataset (not live), updated periodically. Recent papers fall through to arXiv native HTML or PDF
- Hybrid search: FTS (title + abstract + sections) + Vector (abstract embedding) merged via RRF with citation authority boost
- Bearer token auth on `/api/*` endpoints
- REST routes use Hono method chaining for AppType inference (hono/client)
- CLI is a read-only interface; no manual ingestion API
- Cron (`0 3 * * 1-5 UTC`): OAI-PMH bulk harvest all categories → batch insert with metadata → batch embed abstracts → DO scheduler for content fetch
- OAI-PMH endpoint: `oaipmh.arxiv.org/oai` (not export.arxiv.org), arXiv metadata prefix, no set param
- ArxivFetchScheduler DO: holds pending content fetches, fires alarm every 3s to send one Queue message
- release-please with `bump-minor-pre-major` and `separate-pull-requests: false`
