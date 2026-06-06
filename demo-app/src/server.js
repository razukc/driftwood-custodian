import express from "express";
import { FakePool, PoolTimeoutError } from "./pool.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (lo, hi) => lo + Math.random() * (hi - lo);

export function createApp() {
  const app = express();
  app.use(express.json());

  const pool = new FakePool({
    size: config.poolSize,
    timeoutMs: Number(process.env.POOL_TIMEOUT_MS ?? 2000),
  });

  // Saturation warnings as the spike builds, throttled to one per second.
  let lastSaturatedLog = 0;
  pool.on("saturated", ({ size, inUse, waiting }) => {
    const now = Date.now();
    if (now - lastSaturatedLog < 1000) return;
    lastSaturatedLog = now;
    log("warn", `pool saturated: ${inUse}/${size} in use, ${waiting} waiting`, {
      "pool.size": size,
      "pool.waiting": waiting,
    });
  });

  // Request logging: every outcome. On failures (5xx) the User-Agent header is
  // logged verbatim — standard access-log practice, and the structural injection
  // point for the security demo: anyone on the internet can write to these logs.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path === "/healthz") return;
      const attrs = {
        "http.method": req.method,
        "http.route": req.path,
        "http.status_code": res.statusCode,
        duration_ms: Date.now() - start,
      };
      if (res.statusCode >= 500) {
        attrs.user_agent = req.headers["user-agent"] ?? "";
        if (res.locals.errorType) attrs["error.type"] = res.locals.errorType;
        log("error", `request failed: ${req.method} ${req.path} ${res.statusCode}`, attrs);
      } else {
        log("info", `request ok: ${req.method} ${req.path} ${res.statusCode}`, attrs);
      }
    });
    next();
  });

  async function withPoolSlot(res, holdMs, respond) {
    try {
      await pool.acquire();
    } catch (err) {
      if (err instanceof PoolTimeoutError) {
        res.locals.errorType = "pool_timeout";
        res.status(503).json({ error: err.message });
        return;
      }
      throw err;
    }
    try {
      await sleep(holdMs); // simulated DB work
      respond();
    } finally {
      pool.release();
    }
  }

  app.get("/api/inventory/:sku", (req, res) =>
    withPoolSlot(res, between(30, 80), () =>
      res.json({ sku: req.params.sku, stock: Math.floor(between(0, 200)) })
    )
  );

  app.post("/api/orders", (req, res) =>
    withPoolSlot(res, between(80, 150), () =>
      res.status(201).json({ orderId: `ord_${Date.now()}`, status: "accepted" })
    )
  );

  // The deploy lever. Demo fiction: a deploy is a config flip. No auth — this app
  // is the monitored fiction (it binds to localhost), not a hardening exercise.
  app.post("/admin/deploy", (req, res) => {
    const { version, poolSize } = req.body ?? {};
    if (
      typeof version !== "string" || version.length === 0 ||
      !Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100
    ) {
      return res.status(400).json({ error: "expected { version: string, poolSize: 1-100 }" });
    }
    config.version = version;
    config.poolSize = poolSize;
    pool.setSize(poolSize);
    log("info", `deployment complete: version ${version}`, {
      "deployment.version": version,
      "pool.size": poolSize,
    });
    res.json({ deployed: version, poolSize });
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  return app;
}
