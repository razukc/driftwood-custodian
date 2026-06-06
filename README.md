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
| `agent/` | The investigation agent (two-path prompting, human-in-the-loop on remediation, OTel self-instrumentation) |
| `demo-app/` | Driftwood's demo service — emits logs to Dynatrace, with an injectable request path for the poisoned-log line |
| `policy/` | The capability manifest and the sandbox policies compiled from it (Docker + bubblewrap) |
| `scripts/` | Verification utilities (MCP handshake / tool-inventory check) |
| `BUILD_NOTES.md` | Findings recorded during the build |

## Disclosure

I'm also the author of [capgate](https://github.com/razukc/capgate); the submission
uses it as one of several design tools, and is judged on the agent's behavior, not
on capgate as a product.

## License

Apache-2.0
