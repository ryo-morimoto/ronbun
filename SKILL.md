---
name: ronbun
description: Academic paper search and browsing best practices using ronbun CLI. Use when working with arXiv papers, literature reviews, citation analysis, or building research workflows. Triggers on tasks involving paper discovery, reading lists, citation graphs, or research question exploration.
license: MIT
metadata:
  author: ryo-morimoto
  version: "1.0.0"
---

# ronbun -- Academic Paper Browser

ronbun is a CLI for searching and browsing academic papers from arXiv. It provides hybrid search (keyword + semantic), citation graph exploration, and full-text section access.

## Setup

```bash
npm install -g @ronbun/cli
```

That's it. The CLI connects to the public ronbun instance by default.

## CLI Commands

### search -- Find papers with hybrid search

```bash
ronbun search <query> [--category <cat>] [--year-from <y>] [--year-to <y>] [--limit <n>]
```

- `query` (required): Natural language or keyword query (1-500 chars)
- `--category`: arXiv category filter (e.g., `cs.AI`, `cs.CL`, `stat.ML`)
- `--year-from` / `--year-to`: Publication year range
- `--limit`: Max results (default: 10, max: 50)

Results are ranked by keyword relevance, semantic similarity, and citation count.

### show -- View full paper details

```bash
ronbun show <id|arxivId>
```

Displays title, authors, abstract, section count, citation count, and ingestion status. Accepts a ronbun UUID or arXiv ID (version suffixes like `v1` are stripped automatically).

### list -- Browse ingested papers

```bash
ronbun list [--status <s>] [--category <c>] [--year <y>] [--sort <field:order>] [--limit <n>]
```

- `--status`: `metadata` | `ready` | `failed`
- `--sort`: `published_at:desc`, `created_at:desc` (default), `title:asc`
- `--limit`: Max per page (default: 20, max: 100)

### related -- Explore citation graph

```bash
ronbun related <id|arxivId> [--type <t>] [--limit <n>]
```

- `--type`: `citation` (papers this one cites), `cited_by` (papers citing this one), `shared_author`
- `--limit`: Max results (default: 10, max: 50)

### status -- Check ingestion progress

```bash
ronbun status <arxivId>
```

Shows ingestion status: `metadata` (queued), `ready` (fully ingested), or `failed` (with error details).

## Effective Search Patterns

### Broad to Narrow

Start broad, then add filters:

```bash
ronbun search "large language model reasoning" --limit 20
ronbun search "large language model reasoning" --category cs.CL --year-from 2024
```

### Literature Review Workflow

1. `search` for seed papers on your topic
2. `show` to read abstracts and check section structure
3. `related --type citation` to trace what a key paper builds on
4. `related --type cited_by` to find follow-up work
5. `related --type shared_author` to find other work by the same group

### Citation Chain Exploration

```bash
ronbun show 2401.12345                                    # Check citation count
ronbun related 2401.12345 --type cited_by --limit 20      # Who cites this?
ronbun related 2401.12345 --type citation --limit 20      # What does it cite?
```

### Check New Ingestions

Papers are ingested daily (weekdays, 03:00 UTC):

```bash
ronbun list --sort created_at:desc --status ready --limit 10
ronbun status 2401.12345
```
