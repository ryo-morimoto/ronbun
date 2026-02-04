import type { QueueMessage } from "@ronbun/types";

export type RonbunContext = {
  db: D1Database;
  storage: R2Bucket;
  vectorIndex: VectorizeIndex;
  ai: Ai;
  queue: Queue<QueueMessage>;
};
