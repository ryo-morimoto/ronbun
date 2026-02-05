# Changelog

## [0.2.0](https://github.com/ryo-morimoto/ronbun/compare/api-v0.1.0...api-v0.2.0) (2026-02-05)

### Features

- add REST routes, Cron trigger, and OAI-PMH client ([ca402f6](https://github.com/ryo-morimoto/ronbun/commit/ca402f6e8251e382e44b19ea55339d88a4866e8f))
- **api:** make pipeline steps idempotent with cleanup-before-insert ([ca6eaca](https://github.com/ryo-morimoto/ronbun/commit/ca6eacae630980169ba6522a755f18e5ffe4c15e))
- **api:** replace deploy script with deploy:production and deploy:preview ([5adf25c](https://github.com/ryo-morimoto/ronbun/commit/5adf25c93f9baf47235f6d8477e6d4a0e64ff39d))
- **api:** retry-aware queue handler with structured error tracking ([5a64612](https://github.com/ryo-morimoto/ronbun/commit/5a646121ccedae833288517238174c577f7aaa74))
- **api:** split wrangler.toml into production and preview environments ([87af065](https://github.com/ryo-morimoto/ronbun/commit/87af065e03263a83190cf5f714c95e249fff9e38))

### Bug Fixes

- **api:** add per-client rate limiting for public endpoints ([0c21e96](https://github.com/ryo-morimoto/ronbun/commit/0c21e96f9874dea557b8412a3989629d6dfed57b))
- move ai binding into each environment and use bunx for migration scripts ([6936e2e](https://github.com/ryo-morimoto/ronbun/commit/6936e2e653783a1dccb81f69e3aad224d25bc7b7))
