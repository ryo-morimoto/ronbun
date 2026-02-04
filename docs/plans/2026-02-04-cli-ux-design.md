# CLI UX Design

## Goal

ronbun CLI を自分用ターミナルツールとして設計する。論文は Cron で自動取り込みされている前提で、検索・閲覧が主体験。DB にない論文は透過的に arXiv から取り込む。

## Architecture

### Apps 再編

`apps/mcp` を `apps/api` にリネーム・拡張し、REST + MCP + Cron を同居させる。

```
apps/
  api/              Hono サーバー: REST + MCP + Cron（現 apps/mcp をリネーム）
    src/
      index.ts      app 定義、AppType エクスポート
      routes/       REST ルート（papers, extractions, arxiv）
      mcp.ts        MCP サーバー設定
      cron.ts       arXiv 新着自動取り込み
  cli/              hono/client で apps/api を叩く
    src/
      index.ts      citty エントリポイント
      commands/     各コマンド
      lib/          client, format, ansi, prompt, arxiv-id
  web/              将来
```

### パッケージ命名

- `apps/api` の package.json name: **`@ronbun/server`**（既存の `@ronbun/api` ビジネスロジックパッケージとの衝突を回避）
- CLI は `import type { AppType } from "@ronbun/server"` で型参照

### 依存の流れ

```
apps/api (@ronbun/server) → @ronbun/api, @ronbun/arxiv, hono
apps/cli (@ronbun/cli)    → @ronbun/server (型のみ, workspace:*), hono/client, citty
```

CLI は `@ronbun/arxiv` に直接依存しない。arXiv 関連の処理はすべて apps/api の REST エンドポイント経由。

### REST エンドポイント

#### Papers

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/papers/search` | `{ query, category?, yearFrom?, yearTo?, limit? }` | `{ papers: SearchResult[] }` |
| GET | `/api/papers` | query: `category?, year?, status?, sortBy?, sortOrder?, cursor?, limit?` | `{ papers: PaperRow[], cursor: string \| null, hasMore: boolean }` |
| GET | `/api/papers/:id` | - | `PaperDetail \| null` |
| POST | `/api/papers/ingest` | `{ arxivId }` | `IngestResult` |
| POST | `/api/papers/batch-ingest` | `{ arxivIds?, searchQuery? }` | `BatchIngestResult` |
| GET | `/api/papers/:id/related` | query: `linkTypes?, limit?` | `{ relatedPapers: RelatedPaper[] }` |
| GET | `/api/papers/:id/status` | - | `{ id, arxiv_id, title, status, error, created_at, ingested_at }` |

**`:id` パラメータ:** 全ルートで UUID と arXiv ID の両方を受け付ける。サーバー側で `getPaperById()` が両形式をハンドルする（既存動作）。CLI の `ronbun show 2401.15884` は arXiv ID をそのまま `:id` に渡す。

#### Extractions

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/extractions/search` | `{ query, type?, limit? }` | `{ extractions: ExtractionSearchResult[] }` |

#### arXiv（CLI フォールバック用・新規）

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/arxiv/search` | `{ query, maxResults? }` | `{ results: ArxivSearchResult[] }` |
| GET | `/api/arxiv/:arxivId/preview` | - | `{ arxivId, title, authors, abstract, bodyText }` |

**`ArxivSearchResult` 型（新規）:**

```ts
type ArxivSearchResult = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
};
```

**`POST /api/arxiv/search` の実装:**
- 既存の `searchArxivPapers()` は ID のみ返すため、`@ronbun/arxiv` に新関数 `searchArxivPapersWithMetadata()` を追加
- arXiv API の検索結果 XML をパースして `ArxivSearchResult[]` を返す

**`GET /api/arxiv/:arxivId/preview` の実装:**
- `fetchArxivMetadata()` でメタデータ（title, authors, abstract）を取得
- `fetchArxivHtml()` + `parseHtmlContent()` で本文テキストを取得し、セクションを結合して `bodyText` として返す
- レスポンスサイズ制限: bodyText は先頭 10,000 文字で切り詰め
- **HTML 未提供時のフォールバック:** `fetchArxivHtml()` が `null` を返す場合（ar5iv にない古い論文等）、`bodyText: null` を返す。CLI はメタデータ（title, authors, abstract）のみ表示し、`Body: (HTML not available)` と表示
- 上流 fetch には `AbortSignal.timeout(8000)` を設定（Workers の CPU 制限前に構造化エラーを返す）

#### エラーレスポンス

全エンドポイント共通:

```ts
// 4xx / 5xx
{ error: string, code?: string }
```

| HTTP Status | 意味 |
|-------------|------|
| 400 | バリデーションエラー（Zod parse failure） |
| 401 | Bearer token 不正または欠落 |
| 404 | リソースが見つからない |
| 500 | 内部エラー |

### 既存エンドポイント（維持）

| Method | Path | 用途 |
|--------|------|------|
| POST | `/mcp` | MCP JSON-RPC（AI アシスタント向け） |
| GET | `/health` | ヘルスチェック |

旧 `/status/:arxivId` エンドポイントは `/api/papers/:arxivId/status` に移行し削除。

### Hono ルート定義と AppType

```ts
// apps/api/src/routes/papers.ts
import { Hono } from "hono";
import type { Env } from "../env.ts";

const papers = new Hono<{ Bindings: Env }>()
  .post("/search", async (c) => {
    // searchPapers(ctx, body) → c.json(result)
  })
  .get("/", async (c) => {
    // listPapers(ctx, query) → c.json(result)
  })
  .get("/:id", async (c) => {
    // getPaper(ctx, { paperId }) → c.json(result) or 404
  })
  .post("/ingest", async (c) => {
    // ingestPaper(ctx, body) → c.json(result)
  })
  .post("/batch-ingest", async (c) => {
    // batchIngest(ctx, body) → c.json(result)
  })
  .get("/:id/related", async (c) => {
    // findRelated(ctx, { paperId, ...query }) → c.json(result)
  })
  .get("/:arxivId/status", async (c) => {
    // DB query → c.json(row) or 404
  });

export default papers;

// apps/api/src/index.ts
const app = new Hono<{ Bindings: Env }>()
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/api/papers", papers)
  .route("/api/extractions", extractions)
  .route("/api/arxiv", arxiv);

// MCP endpoint は .post("/mcp", ...) で別途追加（chain に含めてもよい）

export type AppType = typeof app;
```

**重要:** Hono の型推論のため、ルート定義は `new Hono()` から method chain で繋ぐ。変数に代入して後から `.get()` を呼ぶと型が失われる。

### tsconfig 要件

hono/client の RPC 型が正しく機能するために:

- `apps/api/tsconfig.json`: `"strict": true`, `"composite": true`, `"declaration": true`
- `apps/cli/tsconfig.json`: `"strict": true`, `"references": [{ "path": "../api" }]`
- 両方で同じバージョンの hono を使用

### 自動取り込み（Cron Trigger）

- Cloudflare Cron で毎日1回実行（`crons = ["0 8 * * *"]` in wrangler.toml）
- **対象カテゴリ:** 設定可能な環境変数 `ARXIV_CATEGORIES`（例: `"cs.CL,cs.LG,cs.AI"`）
- **データソース:** arXiv OAI-PMH API（`ListRecords` verb, `from`/`until` パラメータで日付指定）
  - OAI-PMH は resumption token でページネーション対応
  - 1リクエスト 100 件 × 必要ページ数
- **想定ボリューム:** cs.* 主要カテゴリで 200-400 件/日
- **レート制限:** arXiv API は 3秒間隔を要求。OAI-PMH リクエスト間に `await sleep(3000)` を挿入
- **処理:** 取得した ID を Queue に投入 → 既存パイプライン（metadata → content → extraction → embedding）
- **重複チェック:** DB に既存の arxiv_id はスキップ
- `scheduled()` ハンドラを `ExportedHandler` に追加

## CLI Commands

```
ronbun search <query> [--category <cat>] [--year-from <y>] [--year-to <y>] [--limit <n>]
ronbun show <paperId|arxivId>
ronbun list [--status <s>] [--category <c>] [--year <y>] [--sort <field:order>] [--cursor <c>] [--limit <n>]
ronbun related <paperId> [--type <t>] [--limit <n>]
ronbun extractions <query> [--type <t>] [--limit <n>]
ronbun status <arxivId>
```

`ingest` コマンドは廃止。取り込みは `search` / `show` から透過的に行う。

### フラグと API パラメータの対応

| CLI フラグ | API パラメータ | 備考 |
|-----------|---------------|------|
| `--year-from <y>` | `yearFrom` | search 用 |
| `--year-to <y>` | `yearTo` | search 用 |
| `--year <y>` | `year` | list 用（完全一致） |
| `--sort <field:order>` | `sortBy` + `sortOrder` | 例: `--sort title:asc`, `--sort created_at:desc` |
| `--cursor <c>` | `cursor` | list のページネーション |

### arXiv ID の処理

- 正規表現: `/^\d{4}\.\d{4,5}(v\d+)?$/`（既存 `arxivIdSchema` と一致）
- version suffix (`v1`, `v2`, ...) は受け付けるが、CLI 側（`lib/arxiv-id.ts`）と API 側（`@ronbun/schemas` の `arxivIdSchema` に `.transform()` 追加）の両方で strip する（冪等）
- 旧形式（`hep-th/9905111`）は非対応。対象外と明示

## UX Flows

### "DB にない" の定義

以下の場合、論文は「DB にない」として arXiv フォールバックを発動する:

- DB にレコードが存在しない
- status が `failed` のレコードが存在する（再取り込み）

status が `queued` / `metadata` / `parsed` / `extracted` の場合は取り込み中として扱い、フォールバックしない。`show` では利用可能な情報（タイトル、abstract 等）を表示し、ステータスを付記する。

### search: DB にある場合

```
$ ronbun search "transformer attention"

  2401.15884  Attention Is All You Need (Revisited)         cs.CL  2024
  2312.04321  Efficient Transformer Attention Mechanisms     cs.LG  2023
  2 results
```

### search: DB → arXiv フォールバック

```
$ ronbun search "transformer attention"

  Searching ronbun.dev...
  No results found.

  Search arXiv? [Y/n]:

  [1] 2401.15884  Attention Is All You Need (Revisited)    cs.CL  2024
  [2] 2312.04321  Efficient Transformer Attention...        cs.LG  2023
  [3] 2311.09876  A Survey of Attention in Transformers     cs.CL  2023

  Select papers (number, comma-separated, or 'all') [skip]: 1,3
  ✓ Queued 2401.15884
  ✓ Queued 2311.09876
```

- DB 検索で結果がなければ arXiv 検索を提案（デフォルト Y）
- `POST /api/arxiv/search` を呼んで `ArxivSearchResult[]` を取得（タイトル・カテゴリ・年あり）
- 選択した論文は `POST /api/papers/batch-ingest` で即取り込み（透過的）
- 非 TTY 環境（パイプ・スクリプト）ではプロンプトをスキップし、DB 結果のみ表示

### show: DB にある場合（status: ready）

```
$ ronbun show 2401.15884

  Attention Is All You Need
  2401.15884 · cs.CL · 2024-01-28 · ready

  Authors: Vaswani et al.

  Abstract:
    The dominant sequence transduction models are based on...

  Sections: 8 · Extractions: 12 · Citations: 43
```

### show: DB にある場合（status: queued/metadata/parsed/extracted）

```
$ ronbun show 2401.15884

  Attention Is All You Need
  2401.15884 · cs.CL · 2024-01-28 · metadata (processing)

  Authors: Vaswani et al.

  Abstract:
    The dominant sequence transduction models are based on...

  ⟳ Ingestion in progress (use `ronbun status 2401.15884` to check)
```

利用可能な情報だけ表示。セクション・抽出・引用の統計は ingestion 完了まで非表示。

### show: DB → arXiv フォールバック（即時プレビュー + バックグラウンド ingest）

```
$ ronbun show 2401.15884

  Not found on ronbun.dev.

  Fetch from arXiv? [Y/n]:

  Attention Is All You Need            [arXiv · preview]
  2401.15884 · 2024-01-28

  Abstract:
    The dominant sequence transduction models are based on...

  Body:
    The dominant sequence transduction models are based on complex
    recurrent or convolutional neural networks that include an encoder
    and a decoder. The best performing models also connect the encoder
    ...
    (showing first 10,000 characters)

  ⟳ Ingesting in background (use `ronbun status 2401.15884` to check)
```

- `GET /api/arxiv/:arxivId/preview` を呼んで即座に表示
- 同時に `POST /api/papers/ingest` をバックグラウンドで呼び出し
- **制約:** セクション分割・抽出・引用グラフ・ベクトル検索は ingest 完了後に利用可能
- `[arXiv · preview]` ラベルで完全版でないことを明示
- bodyText は先頭 10,000 文字で切り詰め（API 側で制限）
- ingest 完了後に再度 `ronbun show` すれば完全な詳細が表示される
- **エラーハンドリング:** preview 取得と ingest は独立。preview が失敗しても ingest は続行。ingest が失敗しても preview は表示される

### show: status が failed の場合（再取り込み）

```
$ ronbun show 2401.15884

  2401.15884  Attention Is All You Need
  Status: failed
  Error: PDF parsing timeout

  Re-ingest from arXiv? [Y/n]:
  ✓ Re-queued 2401.15884
```

### list（ページネーション）

```
$ ronbun list --status ready --limit 3

  2401.15884  Attention Is All You Need        ready     2024-01-28
  2312.04321  Efficient Transformer...         ready     2023-12-15
  2311.09876  A Survey of Attention...         ready     2023-11-20
  ─
  3 papers · showing 1-3 · more available

  Next page? [Y/n]:

  2310.12345  Neural Architecture Search...    ready     2023-10-01
  ...
```

- `hasMore` が true の場合、次ページのプロンプトを表示（デフォルト Y）
- 内部で `--cursor` を使って次ページを取得
- 非 TTY 環境ではプロンプトなし、1ページのみ表示。`--cursor` フラグで手動ページ送り

### status

```
$ ronbun status 2401.15884

  2401.15884  Attention Is All You Need
  Status: extracted (3/4)
  Queued: 2024-01-28 10:00:00
```

## Output Format

- 人間向け整形がデフォルト
- `--json` フラグは設けない（スコープ外）
- 左 2 スペースインデント
- タイトルはボールド。1行表示時はターミナル幅に応じて動的 truncate（最低 60 文字、デフォルト `process.stdout.columns - 30` で算出）
- status は色分け（ready=green, queued/metadata/parsed/extracted=yellow, failed=red）
- エラーは `✗ <message>` を stderr に赤字
- `NO_COLOR` 環境変数対応（設定されていれば全色付けを無効化）
- ANSI エスケープ直書き（外部依存なし）

## Error Handling

### API 接続エラー

| 状況 | 表示 |
|------|------|
| 接続拒否 / DNS 解決失敗 | `✗ Cannot connect to ronbun API at <url>` + `Check RONBUN_API_URL environment variable` |
| 401 Unauthorized | `✗ Authentication failed` + `Check RONBUN_API_TOKEN environment variable` |
| タイムアウト（10秒） | `✗ Request timed out` |
| 5xx | `✗ Server error: <status> <message>` |

### arXiv フォールバックの部分失敗

`show` のフォールバックは preview 取得と ingest の 2 つの独立した処理:

| preview | ingest | 結果 |
|---------|--------|------|
| 成功 | 成功 | 正常表示 + 「Ingesting in background」 |
| 成功 | 失敗 | 正常表示 + `⚠ Failed to queue ingestion: <error>` |
| 失敗 | 成功 | `✗ Failed to fetch preview: <error>` + 「Ingesting in background」 |
| 失敗 | 失敗 | `✗ Failed to fetch from arXiv: <error>` |

### 非 TTY 環境

stdin が TTY でない場合（パイプ、スクリプト実行時）:
- Y/n プロンプトは表示せず、arXiv フォールバックはスキップ
- 番号選択プロンプトは表示せず、DB 結果のみ出力
- list のページネーションプロンプトは表示せず、1ページのみ

## Tech Choices

| 用途 | 選択 | 理由 |
|------|------|------|
| コマンドパーサー | citty | unjs 製、軽量、サブコマンド対応、型安全 |
| API クライアント | hono/client (hc) | 型安全、apps/api の AppType から自動推論 |
| 色付け | ANSI 直書き | 外部依存なし |
| 対話入力 | Bun の `process.stdin` + readline | Bun ネイティブ。非 TTY 検知は `process.stdin.isTTY` |
| ランタイム | Bun | `#!/usr/bin/env bun` で直接実行。ビルドステップなし |

### hono/client の認証設定

```ts
import { hc } from "hono/client";
import type { AppType } from "@ronbun/server";

const client = hc<AppType>(API_URL, {
  headers: { Authorization: `Bearer ${API_TOKEN}` },
});
```

## File Structure

```
apps/cli/
  src/
    index.ts              citty runMain + subCommands
    commands/
      search.ts           search コマンド（DB → arXiv フォールバック）
      show.ts             show コマンド（DB → arXiv フォールバック）
      list.ts             list コマンド（ページネーション対応）
      related.ts          related コマンド
      extractions.ts      extractions コマンド
      status.ts           status コマンド
    lib/
      client.ts           hono/client ラッパー（認証ヘッダー設定）
      format.ts           出力フォーマッタ（formatPaperRow, formatDetail, formatPreview 等）
      ansi.ts             ANSI ヘルパー（bold, dim, red, green, yellow, truncate）+ NO_COLOR
      prompt.ts           stdin 対話入力（Y/n 確認、番号選択）+ 非 TTY 検知
      arxiv-id.ts         arXiv ID 判定 + version suffix strip
  package.json
  tsconfig.json
```

## Testing

- `lib/format.ts` -- ユニットテスト。SearchResult / PaperDetail → 文字列出力の assert
- `lib/ansi.ts` -- NO_COLOR 対応テスト、truncate テスト
- `lib/arxiv-id.ts` -- arXiv ID 判定テスト（新形式、version suffix あり/なし、旧形式 reject）
- `lib/prompt.ts` -- stdin モックで対話入力テスト、非 TTY 時のスキップテスト
- `commands/*.ts` -- client モックで正しい API コール発行を assert、フォールバックフロー含む
- テストランナー: vitest

## Configuration

| 環境変数 | デフォルト | 用途 |
|----------|-----------|------|
| `RONBUN_API_URL` | `http://localhost:8787` | API エンドポイント |
| `RONBUN_API_TOKEN` | (なし、必須) | Bearer token |
| `NO_COLOR` | (なし) | 設定されていれば色付け無効 |

## Changes Required in Existing Packages

### `@ronbun/arxiv` -- 新関数追加

`searchArxivPapersWithMetadata(query, maxResults)` → `ArxivSearchResult[]`

既存の `searchArxivPapers()` は ID のみ返す。新関数は arXiv API の XML レスポンスからメタデータ（title, authors, abstract, categories, publishedAt）もパースして返す。内部的には既存の `parseArxivXml` ロジックを再利用。

### `@ronbun/arxiv` -- OAI-PMH クライアント追加

Cron Trigger 用に `fetchNewPapersByCategory(categories, fromDate, untilDate)` を追加。arXiv OAI-PMH API（`oai_dc:dc` メタデータ形式）を使用。既存の Atom API とは異なる XML フォーマットのため、専用パーサーが必要。resumption token によるページネーションを内部で処理し、arXiv ID のリストを返す。

### `@ronbun/api` -- ingestPaper の failed 対応

既存の `ingestPaper()` は paper が DB に存在すれば「Paper already exists」を返す。status が `failed` の場合は既存レコードを削除して再取り込みする動作に変更。
