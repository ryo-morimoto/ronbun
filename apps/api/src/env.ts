import type { QueueMessage } from "@ronbun/types";

export type Env = {
  DB: D1Database;
  STORAGE: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
  INGEST_QUEUE: Queue<QueueMessage>;
  INGEST_DLQ: Queue<QueueMessage>;
  AI: Ai;
  API_TOKEN: string;
  ARXIV_CATEGORIES: string;
};
