# driftwood-custodian

> A custodian acts only within the authority it's been given.

An incident-investigation agent for Driftwood — a 25-person B2B SaaS startup whose
on-call engineer, Maya, is two months in and paged for services she hasn't learned
yet. The agent investigates production problems end-to-end through the
[Dynatrace MCP server](https://github.com/dynatrace-oss/dynatrace-mcp), and it runs
inside a sandbox compiled from a declared capability manifest — **an agent that won't
do things it wasn't told it's allowed to do.**

## The threat model, in one sentence

Anyone on the internet can write to the logs your agent reads.

An agent whose job is parsing logs is parsing whatever an attacker typed into a
request header. This submission demos both paths:

- **Happy path** — Maya asks the agent to investigate an active problem. It reasons,
  plans, queries Dynatrace (problems, DQL over Grail, entities, Davis analyzers),
  and produces a root-cause summary with a remediation proposal.
- **Security path** — a poisoned log line instructs the agent to exfiltrate what it
  found to attacker infrastructure. The agent takes the bait; the compiled egress
  allowlist refuses the connection, visibly; the agent reports the failure, and Maya
  sees exactly what was attempted.

## Layout

| Path | What |
|---|---|
| `driftwood-agent/` | The investigation agent (two-path prompting, human-in-the-loop on remediation, OTel self-instrumentation — its own spans export to the Dynatrace tenant it investigates) |
| `demo-app/` | Driftwood's demo service — emits logs to Dynatrace, with an injectable request path for the poisoned-log line |
| `policy/` | The capability manifest and the sandbox policies compiled from it (Docker + bubblewrap) |
| `scripts/` | Verification utilities (MCP handshake / tool-inventory check) and `deploy.sh` (reproducible Cloud Run deploy) |
| `BUILD_NOTES.md` | Findings recorded during the build |

## Try it live

The agent and demo service are hosted on Google Cloud Run:

- **Agent (dev UI):** https://driftwood-agent-1035154342517.us-east1.run.app/dev-ui/?app=app
- **Landing page:** https://razukc.github.io/driftwood-custodian/

Ask the agent: `Investigate the driftwood-inventory service`.

## Quick Start (for judges)

### Prerequisites

- Node.js 22+ (the Dynatrace MCP server's bundled undici requires Node ≥22), Python 3.12+, Docker
- Google Cloud: Vertex AI ADC auth (`gcloud auth application-default login`)
- Dynatrace: Trial tenant + MCP server credentials

### Setup

```bash
# Install dependencies
npm install                          # MCP server + demo app
uv sync --project driftwood-agent    # Python agent (uv.lock is the source of truth)

# Configure credentials (gitignored .env file)
cat > .env <<EOF
DT_ENVIRONMENT=your-environment-id
DT_PLATFORM_TOKEN=your-platform-token
GOOGLE_CLOUD_PROJECT=your-gcp-project
GOOGLE_CLOUD_LOCATION=global
EOF

# Start the ADK API server (one terminal)
adk api_server --host 127.0.0.1 --port 8123 driftwood-agent

# Run the agent (another terminal)
node scripts/agent-session.mjs http://127.0.0.1:8123
[maya] > Investigate the driftwood-inventory service
```

### See the two-path demo

**Happy path:** Bad deployment → agent investigates DQL → finds root cause → proposes rollback (HITL-approved)  
**Security path:** Poisoned log (injection directive) → agent detects as DATA not instruction → reports to operator

```bash
# Full rehearsal (sets up incident, injects poison, runs agent, confirms rollback)
node scripts/rehearsal.mjs
```

## Architecture

- **Agent:** Python ADK (Gemini-3.5-flash, Vertex AI auth, google-agents-cli scaffold)
- **MCP Integration:** Dynatrace MCP server via `MCPToolset` (stdio spawn, 20 tools, investigation-set filtered)
- **Sandbox:** Docker container, policies compiled from `policy/manifest.json` via [capgate](https://github.com/razukc/capgate)
- **HITL:** Native ADK `require_confirmation=True` on rollback tool
- **Egress enforcement:** Sidecar nftables gateway (reads `policy.docker.json`, default-drop + allowlist, instant `icmpx admin-prohibited` refusal)
- **Self-observability:** the agent exports its own OTLP spans (`invoke_agent`, `call_llm`, MCP tool calls) to the same Dynatrace tenant it investigates — a second `BatchSpanProcessor` bolted onto ADK's Cloud Trace provider, so it's observable as `service.name=driftwood-agent` in Grail

### Deploy

Both services run on Cloud Run. Several runtime settings the demo depends on (demo-app
`--concurrency 250`, the agent's trace env vars and `OTEL_SERVICE_NAME`) live only as
deploy flags, not in any Dockerfile — `scripts/deploy.sh` pins them so a redeploy doesn't
silently regress:

```bash
scripts/deploy.sh both     # demo app, then rebuild + deploy the agent
scripts/deploy.sh agent    # agent only   (demo|agent|both, optional --no-build)
```

## Key findings (BUILD_NOTES)

1. **Tool-level exfil channels:** Email/Slack route through allowed tenant endpoint (declare with `assert:`, not visible to OS-level sandbox)
2. **Grammar gap:** No scope parameterization (`${VAR}`) in capgate v0.0 (candidate for v0.1)
3. **Injection defense verified:** Agent instruction + OS-level egress block work independently; threat model = logs are injectable
4. **Egress enforcement:** Sidecar gateway pattern (nftables, policy-driven, rejects unknown domains with visible refusal, not timeout)
5. **ADK + MCP:** stdio spawn, tool filter at framework layer, two altitudes of security

## Team

- Raju KC (razukc) — Agent development, security design, capgate integration

## Disclosure

Author of [capgate](https://github.com/razukc/capgate). This submission is judged on agent behavior, not capgate as a product.

## License

Apache-2.0
