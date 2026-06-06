import { test } from "node:test";
import assert from "node:assert/strict";
import { FakePool, PoolTimeoutError } from "../src/pool.js";

test("grants immediately when a slot is free", async () => {
  const pool = new FakePool({ size: 1 });
  await pool.acquire();
  assert.equal(pool.inUse, 1);
});

test("queued acquire times out with PoolTimeoutError and leaves the queue", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 50 });
  await pool.acquire();
  await assert.rejects(pool.acquire(), PoolTimeoutError);
  assert.equal(pool.waiting, 0);
});

test("timeout error message matches the spec's log line", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 50 });
  await pool.acquire();
  await assert.rejects(pool.acquire(), {
    message: "connection pool exhausted: timeout acquiring connection after 50ms",
  });
});

test("release grants the next queued waiter", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 1000 });
  await pool.acquire();
  const second = pool.acquire();
  pool.release();
  await second;
  assert.equal(pool.inUse, 1);
});

test("emits saturated with stats when an acquire queues", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 50 });
  await pool.acquire();
  let seen;
  pool.on("saturated", (s) => { seen = s; });
  await assert.rejects(pool.acquire(), PoolTimeoutError);
  assert.deepEqual(seen, { size: 1, inUse: 1, waiting: 1 });
});

test("setSize grows the pool and drains the queue", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 1000 });
  await pool.acquire();
  const second = pool.acquire();
  pool.setSize(2);
  await second;
  assert.equal(pool.inUse, 2);
});

test("shrinking does not revoke held slots; stays full until below new size", async () => {
  const pool = new FakePool({ size: 2, timeoutMs: 50 });
  await pool.acquire();
  await pool.acquire();
  pool.setSize(1);
  assert.equal(pool.inUse, 2);
  pool.release(); // inUse 1 == size 1: still full
  await assert.rejects(pool.acquire(), PoolTimeoutError);
});

test("release without a held slot throws instead of corrupting capacity", () => {
  const pool = new FakePool({ size: 1 });
  assert.throws(() => pool.release(), { message: "release without acquire" });
  assert.equal(pool.inUse, 0);
});

test("no slot leak across many timeouts", async () => {
  const pool = new FakePool({ size: 1, timeoutMs: 10 });
  await pool.acquire();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => pool.acquire())
  );
  assert.ok(results.every((r) => r.status === "rejected"));
  pool.release();
  await pool.acquire(); // pool recovers
  assert.equal(pool.inUse, 1);
});
