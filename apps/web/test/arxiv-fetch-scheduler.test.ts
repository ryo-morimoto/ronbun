import { env } from "cloudflare:test";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { ArxivFetchScheduler } from "../src/server/do/arxiv-fetch-scheduler";

// Use unique DO names per test to avoid state leakage (isolatedStorage: false)
let testCounter = 0;
function getStub() {
  const name = `test-${testCounter++}`;
  const id = env.ARXIV_FETCH_SCHEDULER.idFromName(name);
  return env.ARXIV_FETCH_SCHEDULER.get(id);
}

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    paperId: `paper-${i}`,
    arxivId: `2406.${String(i).padStart(5, "0")}`,
  }));
}

async function drainAlarms(stub: DurableObjectStub<ArxivFetchScheduler>, max = 100) {
  let count = 0;
  while (count < max) {
    const ran = await runDurableObjectAlarm(stub);
    if (!ran) break;
    count++;
  }
  return count;
}

describe("ArxivFetchScheduler", () => {
  it("add-batch stores items and starts alarm", async () => {
    const stub = getStub();

    const res = await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "b1", items: makeItems(3) }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: 3 });

    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);
  });

  it("processes all items through alarm chain", async () => {
    const stub = getStub();

    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "b1", items: makeItems(5) }),
    });

    // 5 items processed via 5 alarms
    // Last item has no hasMore → no further alarm → chain ends
    const alarmsRan = await drainAlarms(stub);
    expect(alarmsRan).toBe(5);

    const progressRes = await stub.fetch("https://do/progress");
    const progress = await progressRes.json<{
      pending: number;
      processed: number;
      total: number;
    }>();
    expect(progress.pending).toBe(0);
    expect(progress.processed).toBe(5);
    expect(progress.total).toBe(5);
  });

  it("alarm chain continues when queue send fails", async () => {
    const stub = getStub();

    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "fail-batch", items: makeItems(3) }),
    });

    // Sabotage the queue binding inside the DO to simulate send failure
    await runInDurableObject(stub, async (instance: ArxivFetchScheduler) => {
      (instance as any).env = {
        ...(instance as any).env,
        INGEST_QUEUE: {
          send: () => {
            throw new Error("simulated queue failure");
          },
        },
      };
    });

    // All 3 items must be processed (skipped) without breaking the chain
    const alarmsRan = await drainAlarms(stub);
    expect(alarmsRan).toBe(3);

    const progressRes = await stub.fetch("https://do/progress");
    const progress = await progressRes.json<{ pending: number; processed: number }>();
    expect(progress.pending).toBe(0);
    expect(progress.processed).toBe(3);
  });

  it("skips empty batch", async () => {
    const stub = getStub();

    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "empty", items: [] }),
    });

    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(false);
  });

  it("processes multiple batches sequentially", async () => {
    const stub = getStub();

    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "batch-a", items: makeItems(2) }),
    });
    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "batch-b", items: makeItems(3) }),
    });

    // batch-a: 2 process + 1 cleanup = 3 alarms
    // batch-b: 3 process alarms (last item ends chain)
    // Total: 6
    const alarmsRan = await drainAlarms(stub);
    expect(alarmsRan).toBe(6);

    const progressRes = await stub.fetch("https://do/progress");
    const progress = await progressRes.json<{
      pending: number;
      processed: number;
      total: number;
    }>();
    expect(progress.pending).toBe(0);
    // batch-a is cleaned up. batch-b remains in storage, fully processed.
    expect(progress.processed).toBe(3);
    expect(progress.total).toBe(3);
  });

  it("progress shows mid-batch state", async () => {
    const stub = getStub();

    await stub.fetch("https://do/add-batch", {
      method: "POST",
      body: JSON.stringify({ batchId: "progress-test", items: makeItems(5) }),
    });

    // Run 2 alarms → 2 items processed
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub);

    const progressRes = await stub.fetch("https://do/progress");
    const progress = await progressRes.json<{
      pending: number;
      processed: number;
      total: number;
      currentBatchId: string;
      batchCount: number;
    }>();
    expect(progress.total).toBe(5);
    expect(progress.processed).toBe(2);
    expect(progress.pending).toBe(3);
    expect(progress.currentBatchId).toBe("progress-test");
    expect(progress.batchCount).toBe(1);
  });

  it("returns 404 for unknown routes", async () => {
    const stub = getStub();
    const res = await stub.fetch("https://do/unknown");
    expect(res.status).toBe(404);
  });
});
