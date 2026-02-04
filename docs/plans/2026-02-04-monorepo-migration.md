# Monorepo Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert ronbun from a single Cloudflare Worker into a Turborepo monorepo with web (TanStack Start), MCP, and CLI apps sharing fine-grained domain packages.

**Architecture:** Extract shared logic into `@ronbun/*` internal packages (types, schemas, arxiv, database, storage, vector, api). Each package receives Cloudflare bindings via dependency injection. Apps are leaves that import packages and wire bindings. Current MCP-formatted responses (`{ content: [{ type: "text", text }] }`) are split: `@ronbun/api` returns plain data, `apps/mcp` wraps in MCP format.

**Tech Stack:** Turborepo, bun workspaces, TypeScript, Hono, MCP SDK, TanStack Start (React) on Cloudflare Pages, Zod, Vitest

---

## Final Directory Structure

```
ronbun/
├── turbo.json
├── package.json                          # root workspaces
├── tsconfig.base.json                    # shared compiler options
├── migrations/                           # shared DB migrations
│   └── 0001_init.sql
├── apps/
│   ├── mcp/                              # Cloudflare Worker (MCP server)
│   │   ├── src/
│   │   │   ├── index.ts                  # Hono + MCP + queue handler
│   │   │   └── env.ts                    # Env type (bindings)
│   │   ├── test/
│   │   │   ├── wrangler.toml
│   │   │   ├── helper.ts
│   │   │   ├── env.d.ts
│   │   │   └── worker.test.ts
│   │   ├── wrangler.toml
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── web/                              # TanStack Start on Cloudflare Pages
│   │   ├── app/
│   │   │   ├── routes/
│   │   │   │   ├── __root.tsx
│   │   │   │   ├── index.tsx
│   │   │   │   ├── search.tsx
│   │   │   │   ├── $arxivId.tsx
│   │   │   │   └── $arxivId.graph.tsx
│   │   │   ├── components/
│   │   │   └── lib/
│   │   ├── vite.config.ts
│   │   ├── wrangler.jsonc
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── cli/                              # CLI tool
│       ├── src/
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── ronbun-types/                     # @ronbun/types
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ronbun-schemas/                   # @ronbun/schemas
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   └── schemas.test.ts
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ronbun-arxiv/                     # @ronbun/arxiv
│   │   ├── src/
│   │   │   ├── api.ts
│   │   │   ├── parser.ts
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   └── arxiv.test.ts
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ronbun-database/                  # @ronbun/database
│   │   ├── src/
│   │   │   ├── papers.ts
│   │   │   ├── sections.ts
│   │   │   ├── extractions.ts
│   │   │   ├── citations.ts
│   │   │   ├── entity-links.ts
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ronbun-storage/                   # @ronbun/storage
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── ronbun-vector/                    # @ronbun/vector
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── ronbun-api/                       # @ronbun/api
│       ├── src/
│       │   ├── ingest.ts
│       │   ├── search.ts
│       │   ├── papers.ts
│       │   ├── queue.ts
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
```

---

## Task 1: Root Monorepo Scaffolding

**Files:**
- Create: `package.json` (overwrite root)
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Delete: `tsconfig.json` (replaced by `tsconfig.base.json`)
- Delete: `vitest.config.ts` (moves to apps/mcp)
- Delete: `wrangler.toml` (moves to apps/mcp)
- Delete: `src/` directory (code moves to packages)
- Delete: `test/` directory (moves to apps/mcp and packages)

**Step 1: Create root package.json**

```json
{
  "name": "ronbun",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:migrate:local": "wrangler d1 migrations apply arxiv-db --local --config apps/mcp/wrangler.toml",
    "db:migrate:remote": "wrangler d1 migrations apply arxiv-db --remote --config apps/mcp/wrangler.toml"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create turbo.json**

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true
  }
}
```

**Step 4: Install turbo**

Run: `bun add -D turbo`

**Step 5: Create directories**

Run: `mkdir -p apps/mcp apps/web apps/cli packages/ronbun-types/src packages/ronbun-schemas/src packages/ronbun-schemas/test packages/ronbun-arxiv/src packages/ronbun-arxiv/test packages/ronbun-database/src packages/ronbun-storage/src packages/ronbun-vector/src packages/ronbun-api/src`

**Step 6: Commit**

```bash
git add turbo.json package.json tsconfig.base.json
git commit -m "chore: initialize turborepo monorepo scaffolding"
```

---

## Task 2: packages/ronbun-types

Extract all shared TypeScript types from `src/types.ts`. Remove the `Env` type (that stays in each app). Remove Cloudflare-specific types from the shared package.

**Files:**
- Create: `packages/ronbun-types/src/index.ts`
- Create: `packages/ronbun-types/package.json`
- Create: `packages/ronbun-types/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/index.ts**

Extract types from current `src/types.ts`, excluding the `Env` type (which depends on Cloudflare bindings). Keep all domain types:

```typescript
export type PaperStatus = "queued" | "metadata" | "parsed" | "extracted" | "ready" | "failed";

export type PaperRow = {
  id: string;
  arxiv_id: string;
  title: string | null;
  authors: string | null;
  abstract: string | null;
  categories: string | null;
  published_at: string | null;
  updated_at: string | null;
  status: PaperStatus;
  error: string | null;
  created_at: string;
  ingested_at: string | null;
};

export type SectionRow = {
  id: string;
  paper_id: string;
  heading: string;
  level: number;
  content: string;
  position: number;
  created_at: string;
};

export type ExtractionType = "method" | "dataset" | "baseline" | "metric" | "result" | "contribution" | "limitation";

export type ExtractionRow = {
  id: string;
  paper_id: string;
  type: ExtractionType;
  name: string;
  detail: string | null;
  section_id: string | null;
  created_at: string;
};

export type CitationRow = {
  id: string;
  source_paper_id: string;
  target_paper_id: string | null;
  target_arxiv_id: string | null;
  target_doi: string | null;
  target_title: string | null;
  created_at: string;
};

export type EntityLinkRow = {
  id: string;
  paper_id: string;
  entity_type: "method" | "dataset" | "author";
  entity_name: string;
  created_at: string;
};

export type QueueStep = "metadata" | "content" | "extraction" | "embedding";

export type QueueMessage = {
  paperId: string;
  arxivId: string;
  step: QueueStep;
  retryCount?: number;
};
```

**Step 4: Run typecheck**

Run: `cd packages/ronbun-types && bun run typecheck`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add packages/ronbun-types
git commit -m "feat: add @ronbun/types package with shared domain types"
```

---

## Task 3: packages/ronbun-schemas

Move Zod schemas from `src/schemas.ts`. Depends on `@ronbun/types`.

**Files:**
- Create: `packages/ronbun-schemas/src/index.ts`
- Create: `packages/ronbun-schemas/test/schemas.test.ts`
- Create: `packages/ronbun-schemas/vitest.config.ts`
- Create: `packages/ronbun-schemas/package.json`
- Create: `packages/ronbun-schemas/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.3"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

**Step 4: Create src/index.ts**

Copy `src/schemas.ts` exactly as-is (it's already pure Zod with no Cloudflare dependencies):

```typescript
import { z } from "zod";

export const arxivIdSchema = z
  .string()
  .regex(/^\d{4}\.\d{4,5}(v\d+)?$/, "Invalid arxiv ID format (e.g. 2401.15884)");

export const ingestPaperInput = z.object({
  arxivId: arxivIdSchema,
});

export const batchIngestInput = z.object({
  arxivIds: z.array(arxivIdSchema).min(1).max(50).optional(),
  searchQuery: z.string().min(1).max(200).optional(),
}).refine((data) => data.arxivIds || data.searchQuery, {
  message: "Either arxivIds or searchQuery must be provided",
});

export const searchPapersInput = z.object({
  query: z.string().min(1).max(500),
  category: z.string().optional(),
  yearFrom: z.number().int().min(1990).max(2030).optional(),
  yearTo: z.number().int().min(1990).max(2030).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getPaperInput = z.object({
  paperId: z.string().min(1),
});

export const listPapersInput = z.object({
  category: z.string().optional(),
  year: z.number().int().min(1990).max(2030).optional(),
  status: z.enum(["queued", "metadata", "parsed", "extracted", "ready", "failed"]).optional(),
  sortBy: z.enum(["published_at", "created_at", "title"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const findRelatedInput = z.object({
  paperId: z.string().min(1),
  linkTypes: z.array(z.enum(["citation", "cited_by", "shared_method", "shared_dataset", "shared_author"])).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const searchExtractionsInput = z.object({
  query: z.string().min(1).max(500),
  type: z.enum(["method", "dataset", "baseline", "metric", "result", "contribution", "limitation"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const queueMessageSchema = z.object({
  paperId: z.string(),
  arxivId: z.string(),
  step: z.enum(["metadata", "content", "extraction", "embedding"]),
  retryCount: z.number().int().optional(),
});
```

**Step 5: Create test/schemas.test.ts**

Copy `test/schemas.test.ts` with updated import path:

```typescript
import { describe, it, expect } from "vitest";
import {
  arxivIdSchema,
  ingestPaperInput,
  batchIngestInput,
  searchPapersInput,
  getPaperInput,
  listPapersInput,
  findRelatedInput,
  searchExtractionsInput,
  queueMessageSchema,
} from "../src/index.ts";

// ... (copy all test cases from current test/schemas.test.ts exactly as-is)
```

**Step 6: Run tests**

Run: `cd packages/ronbun-schemas && bun run test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add packages/ronbun-schemas
git commit -m "feat: add @ronbun/schemas package with Zod validation schemas"
```

---

## Task 4: packages/ronbun-arxiv

Move arXiv API integration and parsers from `src/lib/arxiv.ts`. Pure HTTP + string parsing, no Cloudflare dependencies. Also includes `generateId()` from `src/lib/id.ts`.

**Files:**
- Create: `packages/ronbun-arxiv/src/api.ts` (fetchArxivMetadata, searchArxivPapers)
- Create: `packages/ronbun-arxiv/src/parser.ts` (parseHtmlContent, parsePdfText, fetchArxivHtml, fetchArxivPdf)
- Create: `packages/ronbun-arxiv/src/id.ts` (generateId)
- Create: `packages/ronbun-arxiv/src/index.ts` (re-exports)
- Create: `packages/ronbun-arxiv/test/arxiv.test.ts`
- Create: `packages/ronbun-arxiv/package.json`
- Create: `packages/ronbun-arxiv/tsconfig.json`
- Create: `packages/ronbun-arxiv/vitest.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/arxiv",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

**Step 4: Create src/api.ts**

Extract `fetchArxivMetadata`, `parseArxivXml`, `searchArxivPapers` from `src/lib/arxiv.ts`. Export the `ArxivMetadata` type.

```typescript
export type ArxivMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
  updatedAt: string;
};

export async function fetchArxivMetadata(arxivId: string): Promise<ArxivMetadata> {
  // ... (copy from src/lib/arxiv.ts)
}

function parseArxivXml(xml: string, arxivId: string): ArxivMetadata {
  // ... (copy from src/lib/arxiv.ts)
}

export async function searchArxivPapers(query: string, maxResults: number = 20): Promise<string[]> {
  // ... (copy from src/lib/arxiv.ts)
}
```

**Step 5: Create src/parser.ts**

Extract `fetchArxivHtml`, `fetchArxivPdf`, `parseHtmlContent`, `parsePdfText` and types:

```typescript
export type ParsedSection = {
  heading: string;
  level: number;
  content: string;
  position: number;
};

export type ParsedReference = {
  arxivId: string | null;
  doi: string | null;
  title: string;
};

export type ParsedContent = {
  sections: ParsedSection[];
  references: ParsedReference[];
};

export async function fetchArxivHtml(arxivId: string): Promise<string | null> {
  // ... (copy from src/lib/arxiv.ts)
}

export async function fetchArxivPdf(arxivId: string): Promise<ArrayBuffer | null> {
  // ... (copy from src/lib/arxiv.ts)
}

export function parseHtmlContent(html: string): ParsedContent {
  // ... (copy from src/lib/arxiv.ts)
}

export function parsePdfText(text: string): ParsedContent {
  // ... (copy from src/lib/arxiv.ts)
}
```

**Step 6: Create src/id.ts**

```typescript
export function generateId(): string {
  return crypto.randomUUID();
}
```

**Step 7: Create src/index.ts**

```typescript
export { fetchArxivMetadata, searchArxivPapers } from "./api.ts";
export type { ArxivMetadata } from "./api.ts";

export {
  fetchArxivHtml,
  fetchArxivPdf,
  parseHtmlContent,
  parsePdfText,
} from "./parser.ts";
export type { ParsedSection, ParsedReference, ParsedContent } from "./parser.ts";

export { generateId } from "./id.ts";
```

**Step 8: Create test/arxiv.test.ts**

Copy `test/arxiv.test.ts` with updated import:

```typescript
import { describe, it, expect } from "vitest";
import { parseHtmlContent, parsePdfText } from "../src/parser.ts";

// ... (copy all test cases from current test/arxiv.test.ts exactly as-is)
```

**Step 9: Run tests**

Run: `cd packages/ronbun-arxiv && bun run test`
Expected: All tests PASS

**Step 10: Commit**

```bash
git add packages/ronbun-arxiv
git commit -m "feat: add @ronbun/arxiv package with arXiv API and parser"
```

---

## Task 5: packages/ronbun-database

Extract D1 database operations. All functions take `db: D1Database` as first argument (DI pattern). Use `@cloudflare/workers-types` for D1 type.

**Files:**
- Create: `packages/ronbun-database/src/papers.ts`
- Create: `packages/ronbun-database/src/sections.ts`
- Create: `packages/ronbun-database/src/extractions.ts`
- Create: `packages/ronbun-database/src/citations.ts`
- Create: `packages/ronbun-database/src/entity-links.ts`
- Create: `packages/ronbun-database/src/index.ts`
- Create: `packages/ronbun-database/package.json`
- Create: `packages/ronbun-database/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/database",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ronbun/types": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250514.0",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/papers.ts**

Extract paper CRUD operations from the tool functions. All functions receive `db: D1Database`:

```typescript
import type { PaperRow, PaperStatus } from "@ronbun/types";

export async function findPaperByArxivId(
  db: D1Database,
  arxivId: string,
): Promise<Pick<PaperRow, "id" | "arxiv_id" | "status"> | null> {
  return db
    .prepare("SELECT id, arxiv_id, status FROM papers WHERE arxiv_id = ?")
    .bind(arxivId)
    .first<Pick<PaperRow, "id" | "arxiv_id" | "status">>();
}

export async function insertPaper(
  db: D1Database,
  id: string,
  arxivId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)")
    .bind(id, arxivId, now)
    .run();
}

export async function updatePaperMetadata(
  db: D1Database,
  paperId: string,
  metadata: {
    title: string;
    authors: string[];
    abstract: string;
    categories: string[];
    publishedAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE papers
       SET title = ?, authors = ?, abstract = ?, categories = ?,
           published_at = ?, updated_at = ?, status = 'metadata'
       WHERE id = ?`,
    )
    .bind(
      metadata.title,
      JSON.stringify(metadata.authors),
      metadata.abstract,
      JSON.stringify(metadata.categories),
      metadata.publishedAt,
      metadata.updatedAt,
      paperId,
    )
    .run();
}

export async function updatePaperStatus(
  db: D1Database,
  paperId: string,
  status: PaperStatus,
): Promise<void> {
  await db
    .prepare("UPDATE papers SET status = ? WHERE id = ?")
    .bind(status, paperId)
    .run();
}

export async function markPaperReady(
  db: D1Database,
  paperId: string,
): Promise<void> {
  await db
    .prepare("UPDATE papers SET status = 'ready', ingested_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), paperId)
    .run();
}

export async function markPaperFailed(
  db: D1Database,
  paperId: string,
  error: unknown,
): Promise<void> {
  await db
    .prepare("UPDATE papers SET status = 'failed', error = ? WHERE id = ?")
    .bind(String(error), paperId)
    .run();
}

export async function getPaperById(
  db: D1Database,
  id: string,
): Promise<PaperRow | null> {
  return db
    .prepare("SELECT * FROM papers WHERE id = ? OR arxiv_id = ?")
    .bind(id, id)
    .first<PaperRow>();
}

export async function getPaperArxivId(
  db: D1Database,
  paperId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT arxiv_id FROM papers WHERE id = ?")
    .bind(paperId)
    .first<{ arxiv_id: string }>();
  return row?.arxiv_id ?? null;
}

export async function listPapers(
  db: D1Database,
  opts: {
    category?: string;
    year?: number;
    status?: PaperStatus;
    sortBy: string;
    sortOrder: string;
    cursor?: string;
    limit: number;
  },
): Promise<{ papers: PaperRow[]; hasMore: boolean }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.category) {
    conditions.push(`categories LIKE '%"' || ? || '"%'`);
    params.push(opts.category);
  }
  if (opts.year) {
    conditions.push(`published_at LIKE ? || '%'`);
    params.push(opts.year.toString());
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.cursor) {
    if (opts.sortOrder === "desc") {
      conditions.push(
        `(${opts.sortBy} < (SELECT ${opts.sortBy} FROM papers WHERE id = ?) OR (${opts.sortBy} = (SELECT ${opts.sortBy} FROM papers WHERE id = ?) AND id < ?))`,
      );
      params.push(opts.cursor, opts.cursor, opts.cursor);
    } else {
      conditions.push(
        `(${opts.sortBy} > (SELECT ${opts.sortBy} FROM papers WHERE id = ?) OR (${opts.sortBy} = (SELECT ${opts.sortBy} FROM papers WHERE id = ?) AND id > ?))`,
      );
      params.push(opts.cursor, opts.cursor, opts.cursor);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM papers ${whereClause} ORDER BY ${opts.sortBy} ${opts.sortOrder}, id ${opts.sortOrder} LIMIT ?`;
  params.push(opts.limit + 1);

  const result = await db.prepare(query).bind(...params).all<PaperRow>();
  const papers = result.results || [];
  const hasMore = papers.length > opts.limit;
  if (hasMore) papers.pop();

  return { papers, hasMore };
}

export async function searchPapersFts(
  db: D1Database,
  query: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    arxiv_id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
       FROM papers_fts f JOIN papers p ON p.rowid = f.rowid
       WHERE papers_fts MATCH ? AND p.status = 'ready'
       ORDER BY rank LIMIT ?`,
    )
    .bind(query, limit)
    .all();
  return result.results as any;
}

export async function searchSectionsFts(
  db: D1Database,
  query: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    arxiv_id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT DISTINCT p.id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories, p.published_at
       FROM sections_fts f JOIN sections s ON s.rowid = f.rowid
       JOIN papers p ON p.id = s.paper_id
       WHERE sections_fts MATCH ? AND p.status = 'ready' LIMIT ?`,
    )
    .bind(query, limit)
    .all();
  return result.results as any;
}

export async function fetchPapersByIds(
  db: D1Database,
  ids: string[],
): Promise<PaperRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db
    .prepare(`SELECT * FROM papers WHERE id IN (${placeholders}) AND status = 'ready'`)
    .bind(...ids)
    .all<PaperRow>();
  return result.results;
}
```

**Step 4: Create src/sections.ts, src/extractions.ts, src/citations.ts, src/entity-links.ts**

Each file contains the relevant D1 queries extracted from `src/tools/papers.ts` and `src/queue/consumer.ts`. All take `db: D1Database` as first param.

Follow the same DI pattern. Extract:
- `sections.ts`: `getSectionsByPaperId`, `insertSection`, `getSectionsForExtraction`
- `extractions.ts`: `getExtractionsByPaperId`, `insertExtraction`, `searchExtractionsFts`
- `citations.ts`: `getCitationsBySource`, `getCitedBy`, `insertCitation`
- `entity-links.ts`: `insertEntityLink`, `getRelatedPapers`, `findSharedEntities`

**Step 5: Create src/index.ts**

Re-export everything:

```typescript
export * from "./papers.ts";
export * from "./sections.ts";
export * from "./extractions.ts";
export * from "./citations.ts";
export * from "./entity-links.ts";
```

**Step 6: Run typecheck**

Run: `cd packages/ronbun-database && bun run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/ronbun-database
git commit -m "feat: add @ronbun/database package with D1 operations"
```

---

## Task 6: packages/ronbun-storage

R2 storage operations. Thin wrapper, receives `R2Bucket` via DI.

**Files:**
- Create: `packages/ronbun-storage/src/index.ts`
- Create: `packages/ronbun-storage/package.json`
- Create: `packages/ronbun-storage/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/storage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250514.0",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/index.ts**

```typescript
export async function storeHtml(
  storage: R2Bucket,
  arxivId: string,
  content: string,
): Promise<void> {
  await storage.put(`html/${arxivId}.html`, content);
}

export async function storePdf(
  storage: R2Bucket,
  arxivId: string,
  content: ArrayBuffer,
): Promise<void> {
  await storage.put(`pdf/${arxivId}.pdf`, content);
}

export async function getHtml(
  storage: R2Bucket,
  arxivId: string,
): Promise<string | null> {
  const obj = await storage.get(`html/${arxivId}.html`);
  return obj ? obj.text() : null;
}

export async function getPdf(
  storage: R2Bucket,
  arxivId: string,
): Promise<ArrayBuffer | null> {
  const obj = await storage.get(`pdf/${arxivId}.pdf`);
  return obj ? obj.arrayBuffer() : null;
}
```

**Step 4: Run typecheck**

Run: `cd packages/ronbun-storage && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ronbun-storage
git commit -m "feat: add @ronbun/storage package with R2 operations"
```

---

## Task 7: packages/ronbun-vector

Vectorize operations. Receives `VectorizeIndex` and `Ai` via DI.

**Files:**
- Create: `packages/ronbun-vector/src/index.ts`
- Create: `packages/ronbun-vector/package.json`
- Create: `packages/ronbun-vector/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/vector",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250514.0",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/index.ts**

```typescript
export async function generateEmbedding(
  ai: Ai,
  text: string,
): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-large-en-v1.5", {
    text: [text],
  });
  return (response as { data: number[][] }).data[0];
}

export async function semanticSearch(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  query: string,
  topK: number,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  try {
    const embedding = await generateEmbedding(ai, query);
    const results = await vectorIndex.query(embedding, {
      topK,
      returnMetadata: "all",
    });
    if (results.matches) {
      for (const [idx, match] of results.matches.entries()) {
        const pid = (match.metadata?.paperId as string) || match.id;
        if (!scores.has(pid)) {
          scores.set(pid, idx);
        }
      }
    }
  } catch (error) {
    console.error("Semantic search failed:", error);
  }
  return scores;
}

export async function upsertSectionEmbeddings(
  vectorIndex: VectorizeIndex,
  ai: Ai,
  paperId: string,
  sections: Array<{ id: string; heading: string; content: string }>,
): Promise<number> {
  const vectors: VectorizeVector[] = [];
  for (const section of sections) {
    try {
      const values = await generateEmbedding(ai, section.content.slice(0, 8000));
      vectors.push({
        id: section.id,
        values,
        metadata: {
          paperId,
          sectionId: section.id,
          heading: section.heading,
        },
      });
    } catch (error) {
      console.error("Embedding failed for section:", section.id, error);
    }
  }
  if (vectors.length > 0) {
    await vectorIndex.upsert(vectors);
  }
  return vectors.length;
}
```

**Step 4: Run typecheck**

Run: `cd packages/ronbun-vector && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ronbun-vector
git commit -m "feat: add @ronbun/vector package with Vectorize operations"
```

---

## Task 8: packages/ronbun-api

Business logic / use-case layer. Orchestrates database, storage, vector, arxiv packages. Returns **plain data** (not MCP-formatted responses). Defines a `RonbunContext` type for DI.

**Files:**
- Create: `packages/ronbun-api/src/context.ts`
- Create: `packages/ronbun-api/src/ingest.ts`
- Create: `packages/ronbun-api/src/search.ts`
- Create: `packages/ronbun-api/src/papers.ts`
- Create: `packages/ronbun-api/src/queue.ts`
- Create: `packages/ronbun-api/src/index.ts`
- Create: `packages/ronbun-api/package.json`
- Create: `packages/ronbun-api/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@ronbun/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ronbun/arxiv": "workspace:*",
    "@ronbun/database": "workspace:*",
    "@ronbun/schemas": "workspace:*",
    "@ronbun/storage": "workspace:*",
    "@ronbun/types": "workspace:*",
    "@ronbun/vector": "workspace:*",
    "zod": "^3.25.3"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250514.0",
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/context.ts**

Define the dependency injection context:

```typescript
import type { QueueMessage } from "@ronbun/types";

export type RonbunContext = {
  db: D1Database;
  storage: R2Bucket;
  vectorIndex: VectorizeIndex;
  ai: Ai;
  queue: Queue<QueueMessage>;
};
```

**Step 4: Create src/ingest.ts**

Refactor `src/tools/ingest.ts` to return plain data:

```typescript
import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { ingestPaperInput, batchIngestInput } from "@ronbun/schemas";
import { generateId, searchArxivPapers } from "@ronbun/arxiv";
import { findPaperByArxivId, insertPaper } from "@ronbun/database";

export type IngestResult = {
  status: string;
  paperId: string;
  message?: string;
};

export async function ingestPaper(
  ctx: RonbunContext,
  input: { arxivId: string },
): Promise<IngestResult> {
  const parsed = ingestPaperInput.parse(input);
  const existing = await findPaperByArxivId(ctx.db, parsed.arxivId);

  if (existing) {
    return {
      status: existing.status,
      paperId: existing.id,
      message: "Paper already exists",
    };
  }

  const paperId = generateId();
  await insertPaper(ctx.db, paperId, parsed.arxivId);

  const queueMessage: QueueMessage = {
    paperId,
    arxivId: parsed.arxivId,
    step: "metadata",
  };
  await ctx.queue.send(queueMessage);

  return { status: "queued", paperId };
}

export type BatchIngestResult = {
  results: Array<{
    arxivId: string;
    status: string;
    paperId?: string;
    error?: string;
  }>;
  total: number;
};

export async function batchIngest(
  ctx: RonbunContext,
  input: { arxivIds?: string[]; searchQuery?: string },
): Promise<BatchIngestResult> {
  const parsed = batchIngestInput.parse(input);
  let arxivIds: string[] = [];

  if (parsed.searchQuery) {
    arxivIds = await searchArxivPapers(parsed.searchQuery, 50);
  }
  if (parsed.arxivIds) {
    for (const id of parsed.arxivIds) {
      if (!arxivIds.includes(id)) arxivIds.push(id);
    }
  }
  arxivIds = arxivIds.slice(0, 50);

  const results: BatchIngestResult["results"] = [];
  for (const arxivId of arxivIds) {
    try {
      const result = await ingestPaper(ctx, { arxivId });
      results.push({ arxivId, status: result.status, paperId: result.paperId });
    } catch (error) {
      results.push({
        arxivId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, total: results.length };
}
```

**Step 5: Create src/search.ts**

Refactor `src/tools/search.ts` to return plain data, using `@ronbun/database` and `@ronbun/vector`:

```typescript
import type { RonbunContext } from "./context.ts";
import type { PaperRow } from "@ronbun/types";
import { searchPapersInput, searchExtractionsInput } from "@ronbun/schemas";
import {
  searchPapersFts,
  searchSectionsFts,
  fetchPapersByIds,
  searchExtractionsFts,
} from "@ronbun/database";
import { semanticSearch } from "@ronbun/vector";

// ... mergeWithRRF function (same logic)
// ... searchPapers returns { papers: SearchResult[] } (plain data)
// ... searchExtractions returns { extractions: ExtractionSearchResult[] } (plain data)
```

**Step 6: Create src/papers.ts**

Refactor `src/tools/papers.ts` to return plain data:

```typescript
import type { RonbunContext } from "./context.ts";
import { getPaperInput, listPapersInput, findRelatedInput } from "@ronbun/schemas";
import * as db from "@ronbun/database";

// ... getPaper returns plain paper object with sections, extractions, etc.
// ... listPapers returns { papers, cursor, hasMore }
// ... findRelated returns { relatedPapers }
```

**Step 7: Create src/queue.ts**

Refactor `src/queue/consumer.ts` to use packages:

```typescript
import type { RonbunContext } from "./context.ts";
import type { QueueMessage } from "@ronbun/types";
import { queueMessageSchema } from "@ronbun/schemas";
import * as arxiv from "@ronbun/arxiv";
import * as database from "@ronbun/database";
import * as storage from "@ronbun/storage";
import * as vector from "@ronbun/vector";

export async function processQueueMessage(
  ctx: RonbunContext,
  message: QueueMessage,
): Promise<void> {
  const parsed = queueMessageSchema.parse(message);
  switch (parsed.step) {
    case "metadata":
      return processMetadata(ctx, parsed.arxivId, parsed.paperId);
    case "content":
      return processContent(ctx, parsed.arxivId, parsed.paperId);
    case "extraction":
      return processExtraction(ctx, parsed.paperId);
    case "embedding":
      return processEmbedding(ctx, parsed.paperId);
  }
}

// ... processMetadata, processContent, processExtraction, processEmbedding
// (refactored to use package functions instead of direct env.DB calls)
```

**Step 8: Create src/index.ts**

```typescript
export type { RonbunContext } from "./context.ts";
export { ingestPaper, batchIngest } from "./ingest.ts";
export type { IngestResult, BatchIngestResult } from "./ingest.ts";
export { searchPapers, searchExtractions } from "./search.ts";
export { getPaper, listPapers, findRelated } from "./papers.ts";
export { processQueueMessage } from "./queue.ts";
```

**Step 9: Run typecheck**

Run: `cd packages/ronbun-api && bun run typecheck`
Expected: PASS

**Step 10: Commit**

```bash
git add packages/ronbun-api
git commit -m "feat: add @ronbun/api package with business logic layer"
```

---

## Task 9: apps/mcp

Move existing Cloudflare Worker into `apps/mcp`. Wire up to use `@ronbun/api`. MCP tool handlers become thin wrappers that call API functions and format responses.

**Files:**
- Create: `apps/mcp/src/index.ts` (rewrite to use @ronbun/api)
- Create: `apps/mcp/src/env.ts` (Env type with bindings)
- Move: `wrangler.toml` -> `apps/mcp/wrangler.toml` (update migrations_dir)
- Move: `vitest.config.ts` -> `apps/mcp/vitest.config.ts`
- Move: `test/` -> `apps/mcp/test/` (D1 integration tests)
- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`

**Step 1: Create apps/mcp/package.json**

```json
{
  "name": "@ronbun/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@ronbun/api": "workspace:*",
    "@ronbun/types": "workspace:*",
    "hono": "^4.7.6",
    "zod": "^3.25.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.31",
    "@cloudflare/workers-types": "^4.20250514.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4",
    "wrangler": "^4.14.4"
  }
}
```

**Step 2: Create apps/mcp/src/env.ts**

```typescript
import type { QueueMessage } from "@ronbun/types";

export type Env = {
  DB: D1Database;
  STORAGE: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
  INGEST_QUEUE: Queue<QueueMessage>;
  INGEST_DLQ: Queue<QueueMessage>;
  AI: Ai;
  API_TOKEN: string;
};
```

**Step 3: Create apps/mcp/src/index.ts**

Thin wrapper: creates `RonbunContext` from `Env`, registers MCP tools, wraps API results in MCP format:

```typescript
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Env } from "./env.ts";
import type { RonbunContext } from "@ronbun/api";
import {
  ingestPaper,
  batchIngest,
  searchPapers,
  searchExtractions,
  getPaper,
  listPapers,
  findRelated,
  processQueueMessage,
} from "@ronbun/api";

function createContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}

function mcpResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function createMcpServer(env: Env): McpServer {
  const ctx = createContext(env);
  const server = new McpServer({ name: "ronbun", version: "0.1.0" });

  server.registerTool("ingest_paper", { /* same schema */ },
    async ({ arxivId }) => {
      try {
        return mcpResult(await ingestPaper(ctx, { arxivId }));
      } catch (error) {
        return mcpResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  // ... register all other tools with same pattern:
  // call @ronbun/api function -> wrap result with mcpResult()

  return server;
}

// ... Hono app (same structure as current index.ts)
// ... queue handler calls processQueueMessage(ctx, message)
```

**Step 4: Move and update wrangler.toml**

Copy current `wrangler.toml` to `apps/mcp/wrangler.toml`. Update `migrations_dir`:

```toml
name = "ronbun"
main = "src/index.ts"
compatibility_date = "2025-01-29"
compatibility_flags = ["nodejs_compat"]

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "arxiv-db"
database_id = "placeholder-replace-after-creation"
migrations_dir = "../../migrations"

# ... rest same as current
```

**Step 5: Move test files**

Move `test/` -> `apps/mcp/test/`, `vitest.config.ts` -> `apps/mcp/vitest.config.ts`. Update import paths in tests.

**Step 6: Run tests**

Run: `cd apps/mcp && bun run test`
Expected: All existing tests PASS

**Step 7: Run typecheck**

Run: `cd apps/mcp && bun run typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/mcp
git commit -m "feat: add apps/mcp using @ronbun/api packages"
```

---

## Task 10: apps/web (TanStack Start)

Create web frontend using TanStack Start deployed on Cloudflare Pages. Uses `@ronbun/api` via server functions.

**Step 1: Initialize TanStack Start project**

Run: `cd apps/web && npm create @tanstack/start@latest .` (or manually scaffold)

**Step 2: Create apps/web/package.json**

```json
{
  "name": "@ronbun/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ronbun/api": "workspace:*",
    "@ronbun/schemas": "workspace:*",
    "@ronbun/types": "workspace:*",
    "@tanstack/react-router": "latest",
    "@tanstack/react-start": "latest",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "latest",
    "@cloudflare/workers-types": "^4.20250514.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5.8.3",
    "vite": "latest",
    "wrangler": "^4.14.4"
  }
}
```

**Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
  ],
});
```

**Step 4: Create wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ronbun-web",
  "compatibility_date": "2025-01-29",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "arxiv-db",
      "database_id": "placeholder-replace-after-creation"
    }
  ]
}
```

**Step 5: Create route files**

Create `app/routes/__root.tsx` (root layout with nav), `app/routes/index.tsx` (search homepage), `app/routes/search.tsx` (search results), `app/routes/$arxivId.tsx` (paper detail), `app/routes/$arxivId.graph.tsx` (citation graph).

Each route uses `createServerFn` to call `@ronbun/api` functions with D1 binding from the Cloudflare environment.

Example pattern for a server function:

```tsx
import { createServerFn } from "@tanstack/react-start";
import { searchPapers } from "@ronbun/api";

const doSearch = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }) => {
    // Access Cloudflare bindings via platform env
    const env = (globalThis as any).__cf_env__;
    const ctx = { db: env.DB, storage: env.STORAGE, vectorIndex: env.VECTOR_INDEX, ai: env.AI, queue: env.INGEST_QUEUE };
    return searchPapers(ctx, { query: data.query });
  });
```

> Note: The exact pattern for accessing Cloudflare bindings in TanStack Start server functions on Cloudflare Pages should be verified against the latest `@cloudflare/vite-plugin` docs at implementation time. The `getCloudflareContext()` helper may be available.

**Step 6: Run dev server**

Run: `cd apps/web && bun run dev`
Expected: Dev server starts, routes accessible

**Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add apps/web with TanStack Start on Cloudflare Pages"
```

---

## Task 11: apps/cli

CLI tool for terminal-based paper operations. Uses `@ronbun/api` functions. Connects to the MCP server's REST API (or directly to Cloudflare D1 via REST API for local operations).

**Files:**
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`

**Step 1: Create apps/cli/package.json**

```json
{
  "name": "@ronbun/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "ronbun": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ronbun/schemas": "workspace:*",
    "@ronbun/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create src/index.ts**

CLI that calls the deployed MCP server's REST API:

```typescript
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
```

**Step 4: Run typecheck**

Run: `cd apps/cli && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat: add apps/cli with paper management commands"
```

---

## Task 12: Clean Up & Final Wiring

Remove old source files, update CLAUDE.md, verify full monorepo works.

**Step 1: Remove old files**

```bash
rm -rf src/ test/ vitest.config.ts wrangler.toml tsconfig.json .dev.vars.example
```

Keep: `migrations/`, `package.json` (root), `turbo.json`, `tsconfig.base.json`, `CLAUDE.md`, `README.md`

**Step 2: Install all dependencies**

Run: `bun install`

**Step 3: Run full typecheck**

Run: `turbo run typecheck`
Expected: All packages PASS

**Step 4: Run full test suite**

Run: `turbo run test`
Expected: All tests PASS (schemas tests in packages/ronbun-schemas, arxiv tests in packages/ronbun-arxiv, D1 tests in apps/mcp)

**Step 5: Update CLAUDE.md**

Update the project structure section, commands, and conventions to reflect the new monorepo layout.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: complete monorepo migration, remove old source files"
```

---

## Dependency Graph Summary

```
ronbun-types          (no deps)
    ^
ronbun-schemas        (zod, ronbun-types)
    ^
ronbun-arxiv          (no deps)
    ^
ronbun-database       (ronbun-types, @cloudflare/workers-types)
    ^
ronbun-storage        (@cloudflare/workers-types)
    ^
ronbun-vector         (@cloudflare/workers-types)
    ^
ronbun-api            (all packages above)
    ^           ^          ^
apps/mcp    apps/web    apps/cli
```
