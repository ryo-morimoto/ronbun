# Pipeline Error Handling 改善 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** パイプラインの各ステップを冪等にし、リトライ中のステータス管理を改善し、最終リトライ時のみ failed にする。

**Architecture:** 各ステップ関数から `markPaperFailed` を除去し、キューハンドラに集約。各ステップの先頭で前回の中間データをクリーンアップして冪等性を確保。`message.attempts` で最終リトライを判定。

**Tech Stack:** TypeScript, Cloudflare Workers (D1, Queues), Vitest + @cloudflare/vitest-pool-workers

---

### Task 1: Add cleanup database functions

DB クリーンアップ関数を追加して、リトライ時の重複 INSERT を防止する。

**Files:**

- Create: `packages/ronbun-database/src/cleanup.ts`
- Modify: `packages/ronbun-database/src/index.ts:6` (add export)
- Test: `packages/ronbun-database/test/cleanup.test.ts`

**Step 1: Write the failing tests**

Create `packages/ronbun-database/test/cleanup.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { applyMigration } from "./helper.ts";
import {
  deleteAuthorLinksByPaperId,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
  deleteExtractionsByPaperId,
  deleteNonAuthorEntityLinksByPaperId,
} from "../src/cleanup.ts";

beforeAll(async () => {
  await applyMigration(env.DB);
});

describe("cleanup functions", () => {
  const paperId = "cleanup-test-paper";

  beforeAll(async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'parsed', ?)",
    )
      .bind(paperId, "2406.cleanup", new Date().toISOString())
      .run();

    // Seed sections
    await env.DB.prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, 1, ?, 0)",
    )
      .bind("cs-1", paperId, "Intro", "Content")
      .run();
    await env.DB.prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, 1, ?, 1)",
    )
      .bind("cs-2", paperId, "Methods", "Content")
      .run();

    // Seed citations
    await env.DB.prepare(
      "INSERT INTO citations (id, source_paper_id, target_arxiv_id, target_title) VALUES (?, ?, ?, ?)",
    )
      .bind("cc-1", paperId, "2312.00001", "Some paper")
      .run();

    // Seed extractions
    await env.DB.prepare(
      "INSERT INTO extractions (id, paper_id, type, name) VALUES (?, ?, 'method', ?)",
    )
      .bind("ce-1", paperId, "CRAG")
      .run();

    // Seed entity_links (author + method + dataset)
    await env.DB.prepare(
      "INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'author', ?)",
    )
      .bind("cel-1", paperId, "Alice")
      .run();
    await env.DB.prepare(
      "INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'method', ?)",
    )
      .bind("cel-2", paperId, "CRAG")
      .run();
    await env.DB.prepare(
      "INSERT INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'dataset', ?)",
    )
      .bind("cel-3", paperId, "PopQA")
      .run();
  });

  it("deleteAuthorLinksByPaperId removes only author links", async () => {
    await deleteAuthorLinksByPaperId(env.DB, paperId);
    const authors = await env.DB.prepare(
      "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
    )
      .bind(paperId)
      .all();
    expect(authors.results.length).toBe(0);
    // method/dataset links remain
    const others = await env.DB.prepare(
      "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type != 'author'",
    )
      .bind(paperId)
      .all();
    expect(others.results.length).toBe(2);
  });

  it("deleteSectionsByPaperId removes all sections for paper", async () => {
    await deleteSectionsByPaperId(env.DB, paperId);
    const sections = await env.DB.prepare("SELECT * FROM sections WHERE paper_id = ?")
      .bind(paperId)
      .all();
    expect(sections.results.length).toBe(0);
  });

  it("deleteCitationsBySourcePaperId removes citations", async () => {
    await deleteCitationsBySourcePaperId(env.DB, paperId);
    const citations = await env.DB.prepare("SELECT * FROM citations WHERE source_paper_id = ?")
      .bind(paperId)
      .all();
    expect(citations.results.length).toBe(0);
  });

  it("deleteExtractionsByPaperId removes all extractions", async () => {
    await deleteExtractionsByPaperId(env.DB, paperId);
    const extractions = await env.DB.prepare("SELECT * FROM extractions WHERE paper_id = ?")
      .bind(paperId)
      .all();
    expect(extractions.results.length).toBe(0);
  });

  it("deleteNonAuthorEntityLinksByPaperId removes method/dataset links only", async () => {
    // Re-insert for this test since previous tests may have deleted
    await env.DB.prepare(
      "INSERT OR IGNORE INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'author', ?)",
    )
      .bind("cel-re-1", paperId, "Bob")
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO entity_links (id, paper_id, entity_type, entity_name) VALUES (?, ?, 'method', ?)",
    )
      .bind("cel-re-2", paperId, "Transformer")
      .run();

    await deleteNonAuthorEntityLinksByPaperId(env.DB, paperId);
    const remaining = await env.DB.prepare("SELECT * FROM entity_links WHERE paper_id = ?")
      .bind(paperId)
      .all();
    // Only author links should remain
    expect(remaining.results.every((r: any) => r.entity_type === "author")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/ronbun-database && bun run test -- cleanup`
Expected: FAIL — cannot resolve `../src/cleanup.ts`

**Step 3: Write implementation**

Create `packages/ronbun-database/src/cleanup.ts`:

```typescript
export async function deleteAuthorLinksByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db
    .prepare("DELETE FROM entity_links WHERE paper_id = ? AND entity_type = 'author'")
    .bind(paperId)
    .run();
}

export async function deleteSectionsByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db.prepare("DELETE FROM sections WHERE paper_id = ?").bind(paperId).run();
}

export async function deleteCitationsBySourcePaperId(
  db: D1Database,
  paperId: string,
): Promise<void> {
  await db.prepare("DELETE FROM citations WHERE source_paper_id = ?").bind(paperId).run();
}

export async function deleteExtractionsByPaperId(db: D1Database, paperId: string): Promise<void> {
  await db.prepare("DELETE FROM extractions WHERE paper_id = ?").bind(paperId).run();
}

export async function deleteNonAuthorEntityLinksByPaperId(
  db: D1Database,
  paperId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM entity_links WHERE paper_id = ? AND entity_type IN ('method', 'dataset')")
    .bind(paperId)
    .run();
}
```

Add to `packages/ronbun-database/src/index.ts`:

```typescript
export * from "./cleanup.ts";
```

**Step 4: Run test to verify it passes**

Run: `cd packages/ronbun-database && bun run test -- cleanup`
Expected: PASS — all 5 tests

**Step 5: Commit**

```bash
git add packages/ronbun-database/src/cleanup.ts packages/ronbun-database/src/index.ts packages/ronbun-database/test/cleanup.test.ts
git commit -m "feat(database): add cleanup functions for pipeline idempotency"
```

---

### Task 2: Add `updatePaperError` function

error カラムだけを更新する関数を追加する（status は変えない）。

**Files:**

- Modify: `packages/ronbun-database/src/papers.ts:67-76`
- Test: `packages/ronbun-database/test/papers.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/ronbun-database/test/papers.test.ts` (existing file — add a new `describe` block at the end):

```typescript
describe("updatePaperError", () => {
  it("updates error column without changing status", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'metadata', ?)",
    )
      .bind("upe-1", "2406.upe01", new Date().toISOString())
      .run();

    const { updatePaperError } = await import("../src/papers.ts");
    await updatePaperError(
      env.DB,
      "upe-1",
      JSON.stringify({
        step: "content",
        message: "fetch failed",
        name: "Error",
        attempt: 1,
      }),
    );

    const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("upe-1").first();
    expect(paper!.status).toBe("metadata"); // unchanged
    expect(paper!.error).toContain("fetch failed");
    expect(JSON.parse(paper!.error as string).step).toBe("content");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/ronbun-database && bun run test -- papers`
Expected: FAIL — `updatePaperError` is not exported

**Step 3: Write implementation**

Add to `packages/ronbun-database/src/papers.ts` after `markPaperFailed`:

```typescript
export async function updatePaperError(
  db: D1Database,
  paperId: string,
  errorJson: string,
): Promise<void> {
  await db.prepare("UPDATE papers SET error = ? WHERE id = ?").bind(errorJson, paperId).run();
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/ronbun-database && bun run test -- papers`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ronbun-database/src/papers.ts packages/ronbun-database/test/papers.test.ts
git commit -m "feat(database): add updatePaperError for non-destructive error tracking"
```

---

### Task 3: Remove unused `retryCount` from types and schema

**Files:**

- Modify: `packages/ronbun-types/src/index.ts:71` (remove retryCount)
- Modify: `packages/ronbun-schemas/src/index.ts:63` (remove retryCount)

**Step 1: Remove `retryCount` from type**

In `packages/ronbun-types/src/index.ts`, remove line 71:

```typescript
// Before
export type QueueMessage = {
  paperId: string;
  arxivId: string;
  step: QueueStep;
  retryCount?: number; // DELETE THIS LINE
};

// After
export type QueueMessage = {
  paperId: string;
  arxivId: string;
  step: QueueStep;
};
```

**Step 2: Remove `retryCount` from schema**

In `packages/ronbun-schemas/src/index.ts`, remove line 63:

```typescript
// Before
export const queueMessageSchema = z.object({
  paperId: z.string(),
  arxivId: z.string(),
  step: z.enum(["metadata", "content", "extraction", "embedding"]),
  retryCount: z.number().int().optional(), // DELETE THIS LINE
});

// After
export const queueMessageSchema = z.object({
  paperId: z.string(),
  arxivId: z.string(),
  step: z.enum(["metadata", "content", "extraction", "embedding"]),
});
```

**Step 3: Run typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: PASS — `retryCount` was optional and unused, so no breakage

**Step 4: Commit**

```bash
git add packages/ronbun-types/src/index.ts packages/ronbun-schemas/src/index.ts
git commit -m "chore: remove unused retryCount from QueueMessage"
```

---

### Task 4: Make pipeline steps idempotent (remove markPaperFailed, add cleanup)

各ステップの先頭にクリーンアップを追加し、catch から `markPaperFailed` を除去して単純に re-throw する。

**Files:**

- Modify: `packages/ronbun-api/src/queue.ts` (all 4 step functions)

**Step 1: Write failing tests for idempotency**

Add to `apps/api/test/pipeline.test.ts` — new `describe` block:

```typescript
describe("Idempotency (retry safety)", () => {
  it("processMetadata twice does not duplicate author entity_links", async () => {
    await env.DB.prepare(
      "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
    )
      .bind("idem-meta", "2406.idem01", new Date().toISOString())
      .run();

    const mockQueue = createMockQueue();
    const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });
    const msg: QueueMessage = { paperId: "idem-meta", arxivId: "2406.idem01", step: "metadata" };

    await processQueueMessage(ctx, msg);
    await processQueueMessage(ctx, msg); // retry

    const links = await env.DB.prepare(
      "SELECT * FROM entity_links WHERE paper_id = ? AND entity_type = 'author'",
    )
      .bind("idem-meta")
      .all();
    // Mock returns 2 authors — should still be 2, not 4
    expect(links.results.length).toBe(2);
  });

  it("processContent twice does not duplicate sections", async () => {
    await env.DB.prepare(
      "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'metadata', ?)",
    )
      .bind("idem-content", "2406.idem02", "Test", new Date().toISOString())
      .run();

    const mockQueue = createMockQueue();
    const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });
    const msg: QueueMessage = { paperId: "idem-content", arxivId: "2406.idem02", step: "content" };

    await processQueueMessage(ctx, msg);
    const countAfterFirst = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
    )
      .bind("idem-content")
      .first<{ cnt: number }>();

    await processQueueMessage(ctx, msg); // retry
    const countAfterSecond = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM sections WHERE paper_id = ?",
    )
      .bind("idem-content")
      .first<{ cnt: number }>();

    expect(countAfterSecond!.cnt).toBe(countAfterFirst!.cnt);
  });

  it("processExtraction twice does not duplicate extractions", async () => {
    await env.DB.prepare(
      "INSERT INTO papers (id, arxiv_id, title, status, created_at) VALUES (?, ?, ?, 'parsed', ?)",
    )
      .bind("idem-extract", "2406.idem03", "Test", new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO sections (id, paper_id, heading, level, content, position) VALUES (?, ?, ?, 1, ?, 0)",
    )
      .bind("idem-ext-sec", "idem-extract", "Methods", "Transformer approach.")
      .run();

    const mockQueue = createMockQueue();
    const ctx = createContext({ queue: mockQueue as unknown as Queue<QueueMessage> });
    const msg: QueueMessage = {
      paperId: "idem-extract",
      arxivId: "2406.idem03",
      step: "extraction",
    };

    await processQueueMessage(ctx, msg);
    const countAfterFirst = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM extractions WHERE paper_id = ?",
    )
      .bind("idem-extract")
      .first<{ cnt: number }>();

    await processQueueMessage(ctx, msg); // retry
    const countAfterSecond = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM extractions WHERE paper_id = ?",
    )
      .bind("idem-extract")
      .first<{ cnt: number }>();

    expect(countAfterSecond!.cnt).toBe(countAfterFirst!.cnt);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/api && bun run test -- pipeline`
Expected: FAIL — idempotency tests show doubled counts (e.g. 4 authors instead of 2)

**Step 3: Implement changes to `packages/ronbun-api/src/queue.ts`**

Add import:

```typescript
import {
  // ... existing imports ...
  deleteAuthorLinksByPaperId,
  deleteSectionsByPaperId,
  deleteCitationsBySourcePaperId,
  deleteExtractionsByPaperId,
  deleteNonAuthorEntityLinksByPaperId,
} from "@ronbun/database";
```

Update each step function:

**processMetadata** — add cleanup, remove try/catch+markPaperFailed:

```typescript
async function processMetadata(
  ctx: RonbunContext,
  arxivId: string,
  paperId: string,
): Promise<void> {
  await deleteAuthorLinksByPaperId(ctx.db, paperId);

  const metadata = await fetchArxivMetadata(arxivId);
  await updatePaperMetadata(ctx.db, paperId, metadata);

  for (const author of metadata.authors) {
    await insertEntityLink(ctx.db, generateId(), paperId, "author", author);
  }

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "content",
  } satisfies QueueMessage);
}
```

**processContent** — add cleanup, remove try/catch+markPaperFailed:

```typescript
async function processContent(ctx: RonbunContext, arxivId: string, paperId: string): Promise<void> {
  await deleteSectionsByPaperId(ctx.db, paperId);
  await deleteCitationsBySourcePaperId(ctx.db, paperId);

  let parsedContent;

  const htmlContent = await fetchArxivHtml(arxivId);
  if (htmlContent) {
    await storeHtml(ctx.storage, arxivId, htmlContent);
    parsedContent = parseHtmlContent(htmlContent);
  }

  if (!parsedContent) {
    const pdfBuffer = await fetchArxivPdf(arxivId);
    if (pdfBuffer) {
      await storePdf(ctx.storage, arxivId, pdfBuffer);
      const textContent = new TextDecoder().decode(pdfBuffer);
      parsedContent = parsePdfText(textContent);
    }
  }

  if (!parsedContent) {
    throw new Error("Failed to fetch paper content (HTML and PDF both failed)");
  }

  for (const section of parsedContent.sections) {
    await insertSection(
      ctx.db,
      generateId(),
      paperId,
      section.heading,
      section.level,
      section.content,
      section.position,
    );
  }

  for (const ref of parsedContent.references) {
    if (ref.arxivId) {
      const targetPaperId = await findPaperIdByArxivId(ctx.db, ref.arxivId);
      await insertCitation(ctx.db, generateId(), paperId, targetPaperId, ref.arxivId, ref.title);
    }
  }

  await updatePaperStatus(ctx.db, paperId, "parsed");

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "extraction",
  } satisfies QueueMessage);
}
```

**processExtraction** — add cleanup, remove outer try/catch+markPaperFailed (keep inner per-section try/catch):

```typescript
async function processExtraction(ctx: RonbunContext, paperId: string): Promise<void> {
  await deleteExtractionsByPaperId(ctx.db, paperId);
  await deleteNonAuthorEntityLinksByPaperId(ctx.db, paperId);

  const sections = await getSectionsForExtraction(ctx.db, paperId, 10);

  for (const section of sections) {
    const prompt = `Extract structured knowledge from this research paper section as JSON.

Section: ${section.heading}
Content: ${section.content.slice(0, 4000)}

Extract the following as JSON arrays with {name, detail} objects:
- methods: research methods or techniques used
- datasets: datasets mentioned
- baselines: baseline methods compared against
- metrics: evaluation metrics
- results: key numerical or qualitative results
- contributions: main contributions claimed
- limitations: limitations discussed

Return only valid JSON with these keys.`;

    try {
      const response = await ctx.ai.run(
        "@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0],
        {
          messages: [{ role: "user" as const, content: prompt }],
        },
      );

      const responseText =
        typeof response === "string"
          ? response
          : "response" in (response as Record<string, unknown>)
            ? ((response as Record<string, unknown>).response as string)
            : "";

      const extracted = JSON.parse(responseText || "{}");

      const types = [
        "methods",
        "datasets",
        "baselines",
        "metrics",
        "results",
        "contributions",
        "limitations",
      ] as const;
      const typeMap: Record<string, string> = {
        methods: "method",
        datasets: "dataset",
        baselines: "baseline",
        metrics: "metric",
        results: "result",
        contributions: "contribution",
        limitations: "limitation",
      };

      for (const key of types) {
        const items = extracted[key];
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item?.name) {
              await insertExtraction(
                ctx.db,
                generateId(),
                paperId,
                typeMap[key],
                item.name,
                item.detail ?? null,
                section.id,
              );
              if (key === "methods" || key === "datasets") {
                await insertEntityLink(
                  ctx.db,
                  generateId(),
                  paperId,
                  typeMap[key] as "method" | "dataset",
                  item.name,
                );
              }
            }
          }
        }
      }
    } catch (aiError) {
      console.error("AI extraction failed for section:", section.id, aiError);
    }
  }

  await updatePaperStatus(ctx.db, paperId, "extracted");

  const arxivId = await getPaperArxivId(ctx.db, paperId);
  if (!arxivId) throw new Error(`Paper not found: ${paperId}`);

  await ctx.queue.send({
    arxivId,
    paperId,
    step: "embedding",
  } satisfies QueueMessage);
}
```

**processEmbedding** — remove try/catch+markPaperFailed (upsert is already idempotent):

```typescript
async function processEmbedding(ctx: RonbunContext, paperId: string): Promise<void> {
  const sections = await getSectionsForExtraction(ctx.db, paperId, 100);
  await upsertSectionEmbeddings(ctx.vectorIndex, ctx.ai, paperId, sections);
  await markPaperReady(ctx.db, paperId);
}
```

Note: All try/catch wrappers with `markPaperFailed` are removed from all 4 step functions. Errors now propagate to the queue handler.

**Step 4: Run tests to verify they pass**

Run: `cd apps/api && bun run test -- pipeline`
Expected: PASS — idempotency tests pass, but existing error tests will FAIL because they assert `paper.status === 'failed'`. These are fixed in Task 5.

**Step 5: Commit**

```bash
git add packages/ronbun-api/src/queue.ts apps/api/test/pipeline.test.ts
git commit -m "feat(api): make pipeline steps idempotent with cleanup-before-insert"
```

---

### Task 5: Update queue handler with retry-aware error handling

キューハンドラで `message.attempts` を使い、最終リトライ時のみ failed にする。

**Files:**

- Modify: `apps/api/src/index.ts:226-243`
- Modify: `apps/api/test/pipeline.test.ts` (update error tests)

**Step 1: Update existing error tests**

In `apps/api/test/pipeline.test.ts`, update the two tests that assert `status === 'failed'`:

The test "marks paper as failed on metadata fetch error" (line 206) — replace with:

```typescript
it("throws on metadata fetch error without marking failed", async () => {
  vi.mocked(fetchArxivMetadata).mockRejectedValueOnce(new Error("API down"));

  await env.DB.prepare(
    "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'queued', ?)",
  )
    .bind("pm-fail", "2406.10002", new Date().toISOString())
    .run();

  const ctx = createContext();

  await expect(
    processQueueMessage(ctx, {
      paperId: "pm-fail",
      arxivId: "2406.10002",
      step: "metadata",
    }),
  ).rejects.toThrow("API down");

  const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pm-fail").first();
  // Status should remain 'queued' — queue handler (not step) decides failed
  expect(paper!.status).toBe("queued");
});
```

The test "marks paper as failed when both HTML and PDF fail" (line 273) — replace with:

```typescript
it("throws when both HTML and PDF fail without marking failed", async () => {
  vi.mocked(fetchArxivHtml).mockResolvedValueOnce(null);

  await env.DB.prepare(
    "INSERT INTO papers (id, arxiv_id, status, created_at) VALUES (?, ?, 'metadata', ?)",
  )
    .bind("pc-fail", "2406.20002", new Date().toISOString())
    .run();

  const ctx = createContext();

  await expect(
    processQueueMessage(ctx, {
      paperId: "pc-fail",
      arxivId: "2406.20002",
      step: "content",
    }),
  ).rejects.toThrow("Failed to fetch paper content");

  const paper = await env.DB.prepare("SELECT * FROM papers WHERE id = ?").bind("pc-fail").first();
  // Status should remain 'metadata'
  expect(paper!.status).toBe("metadata");
});
```

**Step 2: Update the queue handler in `apps/api/src/index.ts`**

Add import:

```typescript
import { updatePaperError, markPaperFailed } from "@ronbun/database";
```

Replace queue handler (lines 228-239):

```typescript
queue: async (batch: MessageBatch, env: Env) => {
  const ctx = createContext(env);
  const MAX_RETRIES = 3; // matches wrangler.toml max_retries
  for (const message of batch.messages) {
    const body = message.body as QueueMessage;
    try {
      await processQueueMessage(ctx, body);
      message.ack();
    } catch (error) {
      const errorInfo = JSON.stringify({
        step: body.step,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "UnknownError",
        attempt: message.attempts,
      });
      // Store latest error (status unchanged) — ignore DB write failures
      await updatePaperError(ctx.db, body.paperId, errorInfo).catch(() => {});
      if (message.attempts >= MAX_RETRIES) {
        // Final retry exhausted — mark as permanently failed
        await markPaperFailed(ctx.db, body.paperId, errorInfo).catch(() => {});
        console.error(`[${body.step}] permanently failed after ${message.attempts} attempts:`, error);
      } else {
        console.error(`[${body.step}] attempt ${message.attempts}/${MAX_RETRIES}:`, error);
      }
      message.retry();
    }
  }
},
```

**Step 3: Run all tests**

Run: `cd apps/api && bun run test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/index.ts apps/api/test/pipeline.test.ts
git commit -m "feat(api): retry-aware queue handler with structured error tracking"
```

---

### Task 6: Run full typecheck and test suite

**Step 1: Typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

**Step 2: Run all tests**

Run: `bun run test`
Expected: PASS — all packages and apps

**Step 3: Commit (if any fixes needed)**

Only if step 1 or 2 required adjustments.

---

## Summary of changes

| File                                            | Change                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/ronbun-database/src/cleanup.ts`       | NEW — 5 cleanup functions                                                        |
| `packages/ronbun-database/src/index.ts`         | Add `export * from "./cleanup.ts"`                                               |
| `packages/ronbun-database/src/papers.ts`        | Add `updatePaperError()`                                                         |
| `packages/ronbun-database/test/cleanup.test.ts` | NEW — cleanup function tests                                                     |
| `packages/ronbun-database/test/papers.test.ts`  | Add `updatePaperError` test                                                      |
| `packages/ronbun-types/src/index.ts`            | Remove `retryCount` from QueueMessage                                            |
| `packages/ronbun-schemas/src/index.ts`          | Remove `retryCount` from queueMessageSchema                                      |
| `packages/ronbun-api/src/queue.ts`              | Remove try/catch+markPaperFailed from all steps, add cleanup calls               |
| `apps/api/src/index.ts`                         | Queue handler: attempts tracking, structured error JSON, final-retry-only failed |
| `apps/api/test/pipeline.test.ts`                | Update error tests, add idempotency tests                                        |

## Verification

1. `bun run typecheck` — 全パッケージの型チェック
2. `bun run test` — 全テスト通過
3. Preview デプロイ後の手動検証:
   - 正常系: ingest → status が queued → metadata → parsed → extracted → ready
   - 異常系: 存在しない arxiv ID → リトライ後に failed、error に JSON 形式のエラー
   - 冪等性: 同じメッセージを複数回処理しても sections/extractions が重複しない
