import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    exclude: ["node_modules/**", "e2e/**", "playwright.config.ts", "dist/**"],
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: "./test/wrangler.toml" },
        miniflare: {
          bindings: {
            API_TOKEN: "test-token",
            ARXIV_CATEGORIES: "cs.AI,cs.CL,cs.LG",
          },
        },
      },
    },
  },
});
