# Release Automation with release-please

## Overview

Automate versioning, GitHub Releases, npm publishing, and production deploys using [release-please](https://github.com/googleapis/release-please).

## Flow

```
Feature PR → main merge (CI: lint, test, typecheck only)
  ↓
main push triggers:
  1. API preview deploy (automatic)
  2. release-please creates/updates release PRs per app (cli, api)
  ↓
Release PR merged → release-please creates git tag + GitHub Release
  ↓
Same workflow detects release and runs:
  - cli release → bun build + npm publish --provenance
  - api release → D1 migrate + Cloudflare production deploy
```

## Environments

| Environment | Trigger                | Purpose                                      |
| ----------- | ---------------------- | -------------------------------------------- |
| Preview     | main push              | Always reflects latest main for verification |
| Production  | release PR merge (api) | Intentional release only                     |

PR-level preview deploys are removed. PRs are validated by CI tests only.

## release-please Config

### `release-please-config.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "include-component-in-tag": true,
  "separate-pull-requests": true,
  "packages": {
    "apps/cli": {
      "component": "cli",
      "changelog-path": "CHANGELOG.md"
    },
    "apps/api": {
      "component": "api",
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

- `separate-pull-requests: true` — cli and api get independent release PRs
- `include-component-in-tag: true` — tags are `cli-v0.2.0`, `api-v0.3.0`
- Conventional Commits (`feat(cli):`, `fix:`) are used to determine version bumps automatically

### `.release-please-manifest.json`

```json
{
  "apps/cli": "0.1.0",
  "apps/api": "0.1.0"
}
```

Source of truth for current versions.

## Workflow Files

### `ci.yml` (modified)

- Trigger: PR, main push
- Jobs: lint, typecheck, test
- **Remove**: deploy-preview and deploy-production jobs

### `preview.yml` (new)

- Trigger: main push
- Jobs: D1 migrate (preview) + Cloudflare deploy --env preview
- Skip: commits from release-please (release PR merges)

### `release.yml` (new)

- Trigger: main push
- Jobs:
  1. **release-please** — runs `google-github-actions/release-please-action@v4`
  2. **publish-cli** — conditional on `steps.release.outputs.cli--release_created`
     - `bun build src/index.ts --target=node --outfile dist/index.js`
     - Verify/add shebang in dist/index.js
     - `npm publish --provenance`
  3. **deploy-api** — conditional on `steps.release.outputs.api--release_created`
     - D1 migrate (production)
     - Cloudflare deploy --env production
- Permissions: `contents: write`, `pull-requests: write`, `id-token: write`

## File Changes

| File                            | Change                                           |
| ------------------------------- | ------------------------------------------------ |
| `release-please-config.json`    | New: release-please configuration                |
| `.release-please-manifest.json` | New: version manifest                            |
| `.github/workflows/ci.yml`      | Remove deploy-preview and deploy-production jobs |
| `.github/workflows/preview.yml` | New: main push → preview deploy                  |
| `.github/workflows/release.yml` | New: release-please + publish/deploy             |
| `apps/cli/package.json`         | Add `publishConfig.provenance: true`             |

## Edge Cases

### preview deploy on release PR merge

`preview.yml` triggers on release PR merge. Harmless (just a version bump), but can be skipped by checking if the commit author is `release-please[bot]`.

### Hotfixes

Merge hotfix PR to main → release-please updates the release PR → merge release PR immediately. Same flow, just faster.

### Scoped commits

`feat(cli): add search command` — release-please assigns this to the cli package based on the files changed in the commit, not the scope. Commit scopes are for human readability; release-please uses file paths.

## Out of Scope

- `apps/web`: Planned to merge with `apps/api` into `apps/web`. Will be added after that migration (see [#2](https://github.com/ryo-morimoto/ronbun/issues/2)).
- `packages/*`: Internal packages, no version management needed.
