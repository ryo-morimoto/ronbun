/// <reference types="@cloudflare/workers-types/2023-07-01" />
/// <reference types="@cloudflare/vitest-pool-workers" />

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    STORAGE: R2Bucket;
    INGEST_QUEUE: Queue;
    INGEST_DLQ: Queue;
    AI: Ai;
    API_TOKEN: string;
    VECTOR_INDEX: VectorizeIndex;
  }
}
