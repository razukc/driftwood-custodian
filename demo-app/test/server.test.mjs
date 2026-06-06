import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Must be set before importing the app: offline logging, fast pool timeout so the
// exhaustion test completes quickly.
process.env.OTLP_DISABLED = "1";
process.env.POOL_TIMEOUT_MS = "100";

const { createApp } = await import("../src/server.js");

let server;
let base;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("healthz responds ok", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("inventory returns stock under a healthy pool", async () => {
  const res = await fetch(`${base}/api/inventory/SKU-1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sku, "SKU-1");
  assert.equal(typeof body.stock, "number");
});

test("orders are accepted under a healthy pool", async () => {
  const res = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-1", qty: 1 }),
  });
  assert.equal(res.status, 201);
});

test("deploy validates its body", async () => {
  for (const bad of [
    {},
    { version: "1.4.0" },
    { version: "1.4.0", poolSize: 0 },
    { version: "1.4.0", poolSize: 101 },
    { version: "", poolSize: 5 },
    { version: 14, poolSize: 5 },
  ]) {
    const res = await fetch(`${base}/admin/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

test("bad deploy causes pool_timeout 503s under concurrent load", async () => {
  const deploy = await fetch(`${base}/admin/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: "1.4.0-test", poolSize: 1 }),
  });
  assert.equal(deploy.status, 200);

  // pool of 1, holds 30-80ms, timeout 100ms: most of 30 concurrent requests time out
  const results = await Promise.all(
    Array.from({ length: 30 }, () => fetch(`${base}/api/inventory/SKU-2`))
  );
  const codes = results.map((r) => r.status);
  assert.ok(codes.includes(503), `expected 503s, got: ${codes.join(",")}`);
  const body = await results.find((r) => r.status === 503).json();
  assert.match(body.error, /connection pool exhausted/);
});
