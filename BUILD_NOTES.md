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

## 6. Env surface, for the record

Read by the server: `DT_ENVIRONMENT`, `DT_PLATFORM_TOKEN` (injected);
`DT_GRAIL_QUERY_BUDGET_GB` (read, default 1000 GB; trial session showed 5000);
`DT_SSO_URL`, `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` (OAuth flow — unused, we're on
platform token), `SLACK_CONNECTION_ID` (only if Slack tool used),
`DT_MCP_DISABLE_TELEMETRY` + telemetry overrides, `HTTP(S)_PROXY`/`NO_PROXY` (the
"logged but not fully enforced" proxy quirk from the plan). `--clearenv` in the bwrap
policy means anything not declared is stripped — the proxy vars vanish inside the
sandbox, which is *more* deterministic than the server's own proxy handling.
