# Changelog

## [1.0.0](https://github.com/ryo-morimoto/ronbun/compare/web-v0.3.0...web-v1.0.0) (2026-03-31)


### ⚠ BREAKING CHANGES

* **cli:** The `extractions` CLI command has been removed. The `show` and `search` commands no longer offer paper ingestion prompts. Paper ingestion is now handled exclusively by the cron job.

### Features

* **cli:** remove extractions command and mutation operations ([c6b4842](https://github.com/ryo-morimoto/ronbun/commit/c6b4842049aeb0edf476df0c96ef12d7bce0c01c))
* **web:** implement API integration for all pages ([8a17875](https://github.com/ryo-morimoto/ronbun/commit/8a178752eaf5ca042fbba933eaeb10ed799a95c0))


### Bug Fixes

* resolve all TODOs and overhaul ingestion pipeline ([09c3771](https://github.com/ryo-morimoto/ronbun/commit/09c3771a845797597840e621f4c88fc39f074230))
* **web:** align worker entrypoint and deploy configs ([6483210](https://github.com/ryo-morimoto/ronbun/commit/648321004aa014f8dcf1d4976de7f84572dfb84a))

## [0.3.0](https://github.com/ryo-morimoto/ronbun/compare/web-v0.2.0...web-v0.3.0) (2026-02-06)


### Features

* add apps/mcp, apps/web, and apps/cli ([866a702](https://github.com/ryo-morimoto/ronbun/commit/866a70294fcb4f541c33329bf63e7db75368bda4))
* **web:** unify apps/api and apps/web into single TanStack Start app ([b25e248](https://github.com/ryo-morimoto/ronbun/commit/b25e2481c68d57ede5e714f0b076a00850eab227)), closes [#2](https://github.com/ryo-morimoto/ronbun/issues/2)
