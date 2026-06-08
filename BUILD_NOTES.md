# Build notes — capgate manifest for @dynatrace-oss/dynatrace-mcp-server 1.8.6

Night 1–2 slice: hand-authored `manifest.json` (20 tools, from a live `tools/list`
response — first manifest written against a live handshake rather than README prose),
compiled to both adapters (`policy.docker.json`, `policy.bwrap.json`). Both lowered
mechanically. Findings below, in descending order of writeup value.

## 1. Tool-level exfil channels, now concrete (pre-registered finding, confirmed)

`send_email` / `send_slack_message` route through the *allowed* tenant endpoint
(`/platform/email/v1`, app-function Slack connector). The OS-level sandbox cannot
distinguish "agent queries logs" from "agent mails the logs to an attacker" — both are
HTTPS to `egc32068.apps.dynatrace.com:443`. Expressed in the manifest as `assert:`
capabilities (`dynatrace.email_recipients_unbounded`,
`dynatrace.slack_recipients_unbounded`) so the boundary is *declared and auditable*
rather than silently absent. The `assert:` kind — originally motivated by postgres
read-only-txn — absorbed this cleanly. Two-altitudes framing holds.

## 2. Grammar gap: no scope parameterization

The tenant host is environment-dependent (`egc32068.apps.dynatrace.com` is *this
trial*). The manifest hardcodes it; a manifest shipped by Dynatrace upstream would
need something like `net:connect:${DT_ENVIRONMENT}:443` — scope interpolation from
declared env vars. The grammar has no variable syntax. **This is the first real
grammar gap the go/no-go fixtures didn't surface** (all 10 had static hosts).
Workaround: per-deployment manifest authoring. Candidate for grammar 0.1.

## 3. A tool whose only capability is an assertion

`reset_grail_budget` needs no fs/net/exec beyond what the server already holds — its
entire risk is semantic: *the budget guarding `execute_dql` can be reset by the same
principal it constrains*. A tool entry with a lone `assert:` capability is a shape the
fixtures never produced. The compiler handled it (assertions partition independently),
but it's worth a sentence in the writeup: some capabilities are pure governance.

## 4. Telemetry-block beat — verified mechanically

Default OpenKit beacon endpoint baked into the dist: `bf96767wvv.bf.dynatrace.com/mbeacon`
(override: `DT_MCP_TELEMETRY_ENDPOINT_URL`; opt-out: `DT_MCP_DISABLE_TELEMETRY`).
The compiled egress allowlist (tenant + sso only) excludes it — confirmed by checking
`policy.docker.json.egress`. Demo run leaves telemetry ON so the sandbox refusal is
observable. One-liner for the video: "the manifest also surfaced an egress endpoint we
never asked for."

## 5. Real surface is *narrower* than planned

The plan assumed egress = tenant + sso + OTel ingest. Source scan of the dist shows
zero references to `*.live.dynatrace.com` (classic API) — everything goes through the
`.apps.dynatrace.com` platform gateway. Dropped the speculative entry; allowlist is
two hosts. The OTel ingest entry belongs to the **agent's** policy (it runs the
exporter), not the MCP server's — decide at agent-build time whether agent + server
share one sandbox (one merged manifest) or two.

## 6. Demo-app verification gate (2026-06-07/08): three findings, all "config accepted, nothing happened"

Gate per `demo-app/TENANT_SETUP.md` §5, run live against the trial tenant. The
detection pipeline (OTLP logs → Grail → log metric → metric event → Davis
problem) failed silently at three places before working end-to-end. None of
the three produced an error at config time; all three surfaced only by pushing
real data through and watching where it stopped.

**(a) Platform OTLP path rejects token auth.** The gen-3 path
(`.apps.dynatrace.com/platform/otlp/v1/logs`) returns 401 "Unsupported
authorization scheme 'Api-Token'. Dynatrace platform APIs require 'Bearer'."
Api-Token auth means the classic path
(`.live.dynatrace.com/api/v2/otlp/v1/logs`). Consequence for the manifests:
the demo app egresses to `live.dynatrace.com` while the MCP server egresses
only to `apps.dynatrace.com` — same tenant, different API generations,
different hosts. The demo app sits outside the sandbox so this doesn't change
the compiled policy, but it's a concrete instance of why egress must be
enumerated per-process, not per-vendor.

**(b) Classic "Metrics extraction" silently no-ops on OpenPipeline logs.** The
classic Settings screen accepted the log metric (key, matcher, measure) without
complaint; the metric never produced a data point. Logs ingested via OTLP land
in Grail through OpenPipeline, and classic extraction rules never see them.
Fix: a dedicated OpenPipeline pipeline (counter-metric processor, matcher
`error.type == "pool_timeout"`) **plus** a dynamic route
(`service.name == "driftwood-inventory"`) — a pipeline with no route matches
nothing, and routing is first-match. Metric ticked ~1–2 min after the route
was saved (~1,000 timeouts/min at rate 40 against pool 1; threshold 30).

**(c) Metric-key mode can't see Grail metrics.** The metric-event config
accepted key mode at creation; once data existed, selecting the key errored
"This metric is only supported in metric-selector-based query mode," and the
aggregation dropdown pinned to "value". Selector mode with
`log.driftwood.pool_timeouts:splitBy():sum` worked — problem opened on the
**first poll ~60 s after saving** (2-of-3 violating samples, static ≥30/min),
and Davis backdated the problem start to the actual violation onset (~9 min
earlier). Title, ERROR severity, and visibility via `list_problems` (the
agent's own call) all confirmed.

**Lag ledger (recording-night numbers):** OTLP record → queryable in Grail
< 1 min (verified twice, ~40 s each). With the tenant pre-configured,
bad-deploy → problem-open ≈ 3–5 min (ingest + 2 violating minutes). Poisoned
record (User-Agent on a failed request) → readable via the MCP server's
`execute_dql` in ~41 s, full payload rendered as plain text in `user_agent`.
Problem close after rollback: ~10.5 min observed (rollback 19:24:48Z → CLOSED
by 19:35:18Z poll; dealerting 3 clean minutes plus tenant-side evaluation lag).
Close is noticeably slower than open — in the video, "rollback → problem
closes itself" is a narrated time-skip, not dead air.

**Boundary note:** the demo app (`driftwood-inventory`) runs unsandboxed by
design — it is the monitored fiction, not the agent. The sandbox boundary
wraps agent + MCP server only; the app's OTLP export happens outside it.

## 7. Env surface, for the record

Read by the server: `DT_ENVIRONMENT`, `DT_PLATFORM_TOKEN` (injected);
`DT_GRAIL_QUERY_BUDGET_GB` (read, default 1000 GB; trial session showed 5000);
`DT_SSO_URL`, `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` (OAuth flow — unused, we're on
platform token), `SLACK_CONNECTION_ID` (only if Slack tool used),
`DT_MCP_DISABLE_TELEMETRY` + telemetry overrides, `HTTP(S)_PROXY`/`NO_PROXY` (the
"logged but not fully enforced" proxy quirk from the plan). `--clearenv` in the bwrap
policy means anything not declared is stripped — the proxy vars vanish inside the
sandbox, which is *more* deterministic than the server's own proxy handling.

## 8. Egress enforcement lane (agent-slice Task 0 spike, 2026-06-08)

capgate emits `egress[]`; enforcement is the host's job. Spiked three lanes on
Docker Desktop for Windows, top-down by fidelity. **Lane (a) — sidecar gateway —
won on the first try; (b) and (c) never ran.**

Shape: a `driftwood-gateway` container (alpine + nftables, `--cap-add NET_ADMIN`)
reads the *compiled policy file itself* (`policy/policy.docker.json`, mounted
read-only) and programs a default-drop output chain, ACCEPTing only resolved
IPs of the declared `host:port` pairs. Workload containers join with
`--network container:egress-gateway` and inherit the firewall; with
`--cap-drop ALL` they cannot remove it (nftables needs CAP_NET_ADMIN, which
only the gateway holds). DNS stays open to Docker's embedded resolver
(127.0.0.11) only.

Verified from a joined `--cap-drop ALL` container:

| Target | Result |
|---|---|
| `egc32068.apps.dynatrace.com:443` (allowlisted) | TLS handshake completes, HTTP 401 (no token — expected) |
| `example.com:443` | refused in 12 ms |
| `bf96767wvv.bf.dynatrace.com:443` (telemetry beacon) | refused in 67 ms |

Two details that matter for the demo:

- **`reject` not `drop`.** First build used `drop`; denied connects hung to
  curl's timeout. Switched the terminal rule to
  `reject with icmpx admin-prohibited` — the caller gets "Could not connect to
  server" in milliseconds. On camera the agent *reports* the refusal instead
  of stalling; the security beat reads as enforcement, not as a network flake.
- **The gateway consumes the compiled artifact directly.** No hand-copied IP
  list — `jq '.egress[]'` over capgate's output is the entire configuration
  surface. The policy file is the single source of truth from manifest to
  firewall rule, and the deny rule keeps packet counters
  (`nft list chain inet egressgw output`) as refusal evidence.

Caveats, recorded: allowlist is IP-resolved at gateway start + re-resolved
every 60 s, so a rotation inside that window could produce a false deny
(fail-closed — acceptable); the lane enforces *connection* egress, not
tenant-mediated data egress, which is exactly the two-altitudes boundary the
`assert:` entries already declare.
