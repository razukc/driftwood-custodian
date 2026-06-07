# Tenant setup — driftwood-inventory detection pipeline

Manual, one-time configuration in the Dynatrace trial tenant, plus the
verification gate that must pass before agent work starts. Results of the gate
(lag numbers, fallback decision) go to `.local/DEVPOST_NOTES.md` (timeline
material) and `BUILD_NOTES.md` (findings), not this file.

## 1. Verify the OTLP logs endpoint

**Verified 2026-06-07:** the endpoint is the **classic** OTLP path,
`https://egc32068.live.dynatrace.com/api/v2/otlp/v1/logs`. The platform
gateway path (`.apps.dynatrace.com/platform/otlp/v1/logs`) rejects `Api-Token`
auth with 401 — "Dynatrace platform APIs require the authorization scheme
'Bearer'". Token auth means classic API v2. (Consequence worth knowing: the
demo app egresses to `live.dynatrace.com` while the MCP server egresses to
`apps.dynatrace.com` — different API generations, different hosts.)

- Create an access token with scopes: `logs.ingest`, `events.ingest`. Put it in
  `demo-app/.env` as `DT_API_TOKEN`.
- Run `node --env-file=.env scripts/verify-ingest.mjs` and confirm the record
  arrives via the printed DQL. Record the observed ingest lag.
  (2026-06-07 run: arrived in < 1 min, confirmed via the MCP server's
  `execute_dql`.)

> **Sandbox-boundary note (for the agent slice):** the demo app exports OTLP
> from *outside* the sandbox — it is the monitored fiction, not the agent. The
> same ingest endpoint will reappear as a *declared egress entry in the merged
> agent+MCP manifest* because the agent runs its own OTel exporter
> (BUILD_NOTES §5). Verify the endpoint once here; declare it there.

## 2. Verify the events endpoint (deployment marker)

`bad-deploy.mjs` posts `CUSTOM_DEPLOYMENT` to `DT_EVENTS_ENDPOINT`
(`.../api/v2/events/ingest` on the classic domain). This is the **demo app's
own call**, independent of the MCP server — the MCP dist never touches
`live.dynatrace.com` (BUILD_NOTES §5), so the server's behavior tells us
nothing about whether this trial exposes the classic API. Verify directly: run
`bad-deploy.mjs` once with `.env` loaded and check the event appears in the
tenant. (2026-06-07 run: `201 {"reportCount":1,...,"status":"OK"}` — works on
this trial.) If the classic endpoint is unavailable, unset `DT_EVENTS_ENDPOINT` —
the script warns and continues, and the INFO "deployment complete" log line is
the deploy marker the agent finds via DQL instead.

## 3. Log metric (OpenPipeline — classic Metrics extraction does NOT work)

**Verified 2026-06-08:** the classic screen (Settings → Log Monitoring →
Metrics extraction) accepts the config but never matches — OTLP-ingested logs
land in Grail via OpenPipeline, which classic extraction rules don't see. No
error, zero data points (BUILD_NOTES §6b). Configure in the **OpenPipeline**
app instead, two parts, both required:

1. **Pipeline** — OpenPipeline → Logs → Pipelines → add pipeline
   `driftwood-inventory`. On its **Metric extraction** tab add a **Counter
   metric** processor:
   - Matcher (DQL): `error.type == "pool_timeout"`
   - Metric key: `log.driftwood.pool_timeouts`
   - Metric name: `Driftwood pool timeouts`
   - Dimensions: none
2. **Dynamic route** — OpenPipeline → Logs → Dynamic routing → add route
   matching `service.name == "driftwood-inventory"` → target the pipeline
   above. Routing is first-match: the route must sit above any catch-all. A
   pipeline with no route matches nothing.

Extraction applies only to records ingested *after* the route is saved
(observed: metric ticking ~1–2 min after save).

## 4. Metric event → problem (selector mode — key mode does NOT work)

Settings → Anomaly detection → Metric events, new config. **Verified
2026-06-08:** "Metric Key" mode cannot evaluate Grail/OpenPipeline metrics —
selecting the key errors "This metric is only supported in
metric-selector-based query mode" (BUILD_NOTES §6c). Use:

- **Type:** Metric Selector — `log.driftwood.pool_timeouts:splitBy():sum`
  (aggregation lives in the selector string; the separate Aggregation
  dropdown is inert in this mode)
- **Threshold:** static, ≥ 30 per minute, alert when above. The bad deploy
  drops the pool to **1 slot** (`bad-deploy.mjs`); at `--rate=40` the queue
  outgrows the 2 s acquire timeout and most requests fail — observed ~1,000
  timeouts/min, while a healthy pool (50 slots) produces zero.
- **Violating samples:** 2, **Sliding window:** 3, **Dealerting samples:** 3
  (default 3-of-5 alone eats most of the ≤5 min deploy→problem budget; with a
  30× violation margin, 2-of-3 is flap-proof. Dealerting 3 ⇒ rollback→close
  took ~10.5 min including tenant lag — plan the video around it.)
- **Event type:** Error (this is what raises a Davis *problem*)
- **Title:** `Driftwood inventory: connection pool timeouts`

Static threshold, not auto-baseline: a trial tenant has no baseline history,
and determinism on camera beats cleverness. Gate run 2026-06-08: problem
P-26061 opened on the first poll ~60 s after the config was saved, with Davis
backdating the start to the true violation onset.

## 5. Verification gate (must pass before agent work)

Rate note: use `--rate=40` throughout. A 50-slot healthy pool absorbs 40 req/s
cleanly (verified offline); a 1-slot pool fails most of it. One rate, both
regimes — no traffic change mid-demo to explain away.

1. `node --env-file=.env src/main.js` (OTLP live)
2. `node scripts/send-traffic.mjs --rate=40` — let a healthy baseline
   accumulate (~5 min)
3. `node scripts/bad-deploy.mjs`
4. Watch: errors in Grail → metric ticks → **problem opens**. Confirm the
   problem is visible via the MCP server's `list_problems`.
5. Record: ingest lag, metric lag, problem-open lag. Total drives the recording
   timeline (target tolerance: ≤ ~5 min bad-deploy → problem).
6. `node scripts/inject-poison.mjs` while exhausted; confirm the poisoned
   `user_agent` is readable in Grail on the `request failed` ERROR record.
7. `node scripts/rollback.mjs`; confirm errors stop and (eventually) the
   problem closes.

## Fallback (decide at the gate, not recording night)

If metric events on log metrics are restricted on the trial, or total lag
exceeds ~5 min: create `scripts/raise-problem.mjs` (events API, `ERROR_EVENT`,
same title as above) and use it as the problem source. Story degrades from
"Davis detected it" to "an alert fired"; the agent flow (`list_problems`
onward) is identical.
