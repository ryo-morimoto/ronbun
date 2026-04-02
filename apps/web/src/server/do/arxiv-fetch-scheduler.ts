import { DurableObject } from "cloudflare:workers";
import type { QueueMessage } from "@ronbun/types";

type PendingItem = {
  paperId: string;
  arxivId: string;
};

type BatchState = {
  items: PendingItem[];
  nextIndex: number;
  batchId: string;
};

const FETCH_INTERVAL_MS = 3000;

export class ArxivFetchScheduler extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/add-batch" && request.method === "POST") {
      const { batchId, items } = (await request.json()) as {
        batchId: string;
        items: PendingItem[];
      };
      await this.addBatch(batchId, items);
      return Response.json({ queued: items.length });
    }

    if (url.pathname === "/progress") {
      const progress = await this.getProgress();
      return Response.json(progress);
    }

    return new Response("Not found", { status: 404 });
  }

  async addBatch(batchId: string, items: PendingItem[]): Promise<void> {
    if (items.length === 0) return;

    // Load existing batches queue
    const batchQueue = (await this.ctx.storage.get<string[]>("batchQueue")) ?? [];

    // Store batch data
    await this.ctx.storage.put<BatchState>(`batch:${batchId}`, {
      items,
      nextIndex: 0,
      batchId,
    });

    batchQueue.push(batchId);
    await this.ctx.storage.put("batchQueue", batchQueue);

    // Start alarm if not already running
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 100);
    }
  }

  async alarm(): Promise<void> {
    const batchQueue = (await this.ctx.storage.get<string[]>("batchQueue")) ?? [];
    if (batchQueue.length === 0) return;

    const currentBatchId = batchQueue[0];
    const batch = await this.ctx.storage.get<BatchState>(`batch:${currentBatchId}`);
    if (!batch) {
      // Corrupt state — skip this batch
      batchQueue.shift();
      await this.ctx.storage.put("batchQueue", batchQueue);
      if (batchQueue.length > 0) {
        await this.ctx.storage.setAlarm(Date.now() + 100);
      }
      return;
    }

    if (batch.nextIndex >= batch.items.length) {
      // Batch complete — clean up and move to next
      await this.ctx.storage.delete(`batch:${currentBatchId}`);
      batchQueue.shift();
      await this.ctx.storage.put("batchQueue", batchQueue);

      if (batchQueue.length > 0) {
        await this.ctx.storage.setAlarm(Date.now() + 100);
      }
      return;
    }

    const item = batch.items[batch.nextIndex];

    // Advance pointer BEFORE sending (at-most-once; content step is idempotent)
    batch.nextIndex++;
    await this.ctx.storage.put<BatchState>(`batch:${currentBatchId}`, batch);

    // Send content fetch message to queue
    await this.env.INGEST_QUEUE.send({
      paperId: item.paperId,
      arxivId: item.arxivId,
    } satisfies QueueMessage);

    // Schedule next item
    if (batch.nextIndex < batch.items.length || batchQueue.length > 1) {
      await this.ctx.storage.setAlarm(Date.now() + FETCH_INTERVAL_MS);
    }
  }

  async getProgress(): Promise<{
    pending: number;
    processed: number;
    total: number;
    currentBatchId: string | null;
    batchCount: number;
  }> {
    const batchQueue = (await this.ctx.storage.get<string[]>("batchQueue")) ?? [];
    let pending = 0;
    let processed = 0;
    let total = 0;

    for (const batchId of batchQueue) {
      const batch = await this.ctx.storage.get<BatchState>(`batch:${batchId}`);
      if (batch) {
        total += batch.items.length;
        processed += batch.nextIndex;
        pending += batch.items.length - batch.nextIndex;
      }
    }

    return {
      pending,
      processed,
      total,
      currentBatchId: batchQueue[0] ?? null,
      batchCount: batchQueue.length,
    };
  }
}
