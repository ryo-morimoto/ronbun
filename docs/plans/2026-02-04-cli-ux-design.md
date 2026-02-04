# CLI UX Design

## Goal

ronbun CLI を自分用ターミナルツールとして本格的に設計する。論文は Cron で全件自動取り込みされている前提で、検索・閲覧が主体験。DB にない論文は透過的に arXiv から取り込む。

## Architecture

### Apps 再編

`apps/mcp` を `apps/api` にリネーム・拡張し、REST + MCP + Cron を同居させる。

```
apps/
  api/              Hono サーバー: REST + MCP + Cron（現 apps/mcp をリネーム）
    src/
      index.ts      app 定義、AppType エクスポート
      routes/       REST ルート（papers, extractions）
      mcp.ts        MCP サーバー設定
      cron.ts       arXiv 全件自動取り込み
  cli/              hono/client で apps/api を叩く
    src/
      index.ts      citty エントリポイント
      commands/     各コマンド
      lib/          client, format, ansi, prompt, arxiv-id
  web/              将来
```

### 依存の流れ

```
apps/api  → @ronbun/api, hono
apps/cli  → apps/api (型のみ, workspace:*), hono/client, citty
```

Hono の流儀に従い、ルート定義と AppType は `apps/api` に置く。CLI は `import type { AppType } from "@ronbun/api-app"` で型だけ参照し、`hono/client` (`hc`) で型安全に REST を叩く。

### REST エンドポイント（apps/api 新規追加）

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/papers/search` | DB 検索（hybrid search） |
| GET | `/api/papers` | 一覧（フィルタ・ページネーション） |
| GET | `/api/papers/:id` | 論文詳細 |
| POST | `/api/papers/ingest` | 単発取り込み |
| POST | `/api/papers/batch-ingest` | バッチ取り込み |
| GET | `/api/papers/:id/related` | 関連論文 |
| POST | `/api/extractions/search` | 抽出検索 |
| GET | `/api/papers/:arxivId/status` | 取り込み状況 |

### 既存エンドポイント（維持）

| Method | Path | 用途 |
|--------|------|------|
| POST | `/mcp` | MCP JSON-RPC（AI アシスタント向け） |
| GET | `/health` | ヘルスチェック |

### 自動取り込み（Cron Trigger）

- Cloudflare Cron で毎日実行
- arXiv の新着リスト（RSS / OAI-PMH）を全件取得
- Queue に投入 → 既存の 4 ステップパイプライン（metadata → content → extraction → embedding）

## CLI Commands

```
ronbun search <query> [--category <cat>] [--year <year>] [--limit <n>]
ronbun show <paperId|arxivId>
ronbun list [--status <s>] [--category <c>] [--year <y>] [--sort <f>] [--limit <n>]
ronbun related <paperId> [--type <t>] [--limit <n>]
ronbun extractions <query> [--type <t>] [--limit <n>]
ronbun status <arxivId>
```

`ingest` コマンドは廃止。取り込みは `search` / `show` から透過的に行う。

## UX Flows

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
- arXiv 結果を番号付きで表示
- 選択した論文は確認なしで即取り込み（透過的 ingest）

### search: DB にある場合

```
$ ronbun search "transformer attention"

  2401.15884  Attention Is All You Need (Revisited)    cs.CL  2024
  2312.04321  Efficient Transformer Attention...        cs.LG  2023
  2 results
```

### show: DB → arXiv フォールバック

```
$ ronbun show 2401.15884

  Not found on ronbun.dev.

  Fetch from arXiv? [Y/n]:
  ✓ Queued 2401.15884
  Ingesting... (use `ronbun status 2401.15884` to check)
```

### show: DB にある場合

```
$ ronbun show 2401.15884

  Attention Is All You Need
  2401.15884 · cs.CL · 2024-01-28 · ready

  Authors: Vaswani et al.

  Abstract:
    The dominant sequence transduction models are based on...

  Sections: 8 · Extractions: 12 · Citations: 43
```

### list

```
$ ronbun list --status ready --limit 5

  2401.15884  Attention Is All You Need        ready     2024-01-28
  2312.04321  Efficient Transformer...         ready     2023-12-15
  2311.09876  A Survey of Attention...         ready     2023-11-20
  ─
  3 papers · showing 1-3
```

### status

```
$ ronbun status 2401.15884

  2401.15884  Attention Is All You Need
  Status: extracted (3/4)
  Queued: 2024-01-28 10:00:00
```

## Output Format

- 人間向け整形がデフォルト（生 JSON なし）
- 左 2 スペースインデント
- タイトルはボールド、40 文字で truncate + `...`
- status は色分け（ready=green, queued/metadata/parsed/extracted=yellow, failed=red）
- エラーは `✗ Error: <message>` を stderr に赤字
- `NO_COLOR` 環境変数対応
- ANSI エスケープ直書き（外部依存なし）

## Tech Choices

| 用途 | 選択 | 理由 |
|------|------|------|
| コマンドパーサー | citty | unjs 製、軽量、サブコマンド対応、型安全、依存ゼロ |
| API クライアント | hono/client (hc) | 型安全、apps/api の AppType から自動推論 |
| 色付け | ANSI 直書き | 外部依存なし |
| 対話入力 | readline (Node built-in) | 外部依存なし |

## File Structure

```
apps/cli/
  src/
    index.ts              citty runMain + subCommands
    commands/
      search.ts           search コマンド（DB → arXiv フォールバック）
      show.ts             show コマンド（DB → arXiv フォールバック）
      list.ts             list コマンド
      related.ts          related コマンド
      extractions.ts      extractions コマンド
      status.ts           status コマンド
    lib/
      client.ts           hono/client ラッパー
      format.ts           出力フォーマッタ（formatPaperRow, formatDetail 等）
      ansi.ts             ANSI ヘルパー（bold, dim, red, green, yellow, truncate）+ NO_COLOR 対応
      prompt.ts           stdin 対話入力（番号選択、Y/n 確認）
      arxiv-id.ts         arXiv ID 判定（/^\d{4}\.\d{4,5}$/）
  package.json
  tsconfig.json
```

## Testing

- `lib/format.ts` -- ユニットテスト。PaperRow → 文字列出力の assert
- `lib/ansi.ts` -- NO_COLOR 対応テスト
- `lib/arxiv-id.ts` -- arXiv ID 判定の正規表現テスト
- `commands/*.ts` -- client モックで正しい API コール発行を assert
- `lib/prompt.ts` -- stdin モックで対話入力テスト
- テストランナー: vitest

## Configuration

```
RONBUN_API_URL     API endpoint (default: http://localhost:8787)
RONBUN_API_TOKEN   Bearer token for authentication
```
