import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./test/wrangler.toml" },
        miniflare: {
          bindings: {
            API_TOKEN: "test-token",
          },
        },
      },
    },
  },
});
