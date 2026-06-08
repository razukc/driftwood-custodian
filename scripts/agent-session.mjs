// Interactive driver for the driftwood-agent ADK server. Streams a session
// over the HTTP API, prints tool calls as they happen, and relays ADK
// tool-confirmation requests (HITL) to the terminal — the operator types
// yes/no. This is both the rehearsal loop and the on-camera UI.
//
// Usage:  node scripts/agent-session.mjs [serverUrl]
//   then type messages; "exit" quits. Requires the ADK api_server running
//   (adk api_server --host 127.0.0.1 --port 8123 driftwood-agent).
import { createInterface } from "node:readline/promises";

const base = process.argv[2] ?? "http://127.0.0.1:8123";
const appName = "app";
const userId = "maya";
const sessionId = `s-${Math.random().toString(36).slice(2, 8)}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Single consumer for stdin lines. Works both interactively and with piped
// input (where lines arrive before any question is pending and readline's
// question() would otherwise drop them). Returns null once stdin ends.
const lineQueue = [];
const waiters = [];
let stdinClosed = false;
rl.on("line", (l) => {
  const w = waiters.shift();
  if (w) w(l);
  else lineQueue.push(l);
});
rl.on("close", () => {
  stdinClosed = true;
  while (waiters.length) waiters.shift()(null);
});

function nextLine(prompt) {
  process.stdout.write(prompt);
  if (lineQueue.length) {
    const l = lineQueue.shift();
    process.stdout.write(`${l}\n`);
    return Promise.resolve(l);
  }
  if (stdinClosed) return Promise.resolve(null);
  return new Promise((r) => waiters.push(r));
}

async function api(path, body, method = "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function renderEvents(events) {
  // Returns pending confirmation requests found in this batch.
  const confirmations = [];
  for (const e of events ?? []) {
    for (const p of e.content?.parts ?? []) {
      if (p.functionCall) {
        if (p.functionCall.name === "adk_request_confirmation") {
          confirmations.push(p.functionCall);
          continue;
        }
        console.log(`  ⚙ ${p.functionCall.name}(${JSON.stringify(p.functionCall.args ?? {}).slice(0, 140)})`);
      } else if (p.functionResponse) {
        const text = JSON.stringify(p.functionResponse.response ?? {});
        console.log(`  ↳ ${p.functionResponse.name}: ${text.slice(0, 180)}${text.length > 180 ? "…" : ""}`);
      } else if (p.text) {
        console.log(`\n[custodian] ${p.text.trim()}\n`);
      }
    }
  }
  return confirmations;
}

async function send(newMessage) {
  const events = await api("/run", { appName, userId, sessionId, newMessage });
  const confirmations = renderEvents(events);

  for (const fc of confirmations) {
    const original = fc.args?.originalFunctionCall ?? {};
    const hint = fc.args?.toolConfirmation?.hint || "(no hint)";
    console.log("┌─ CONFIRMATION REQUIRED ─────────────────────────");
    console.log(`│ tool: ${original.name}`);
    console.log(`│ args: ${JSON.stringify(original.args ?? {})}`);
    console.log(`│ hint: ${hint}`);
    console.log("└─────────────────────────────────────────────────");
    const answer = ((await nextLine("approve? [yes/no] > ")) ?? "no").trim().toLowerCase();
    const confirmed = answer === "y" || answer === "yes";
    await send({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: fc.id,
            name: "adk_request_confirmation",
            response: { confirmed },
          },
        },
      ],
    });
  }
}

await api(`/apps/${appName}/users/${userId}/sessions/${sessionId}`, {});
console.log(`session ${sessionId} @ ${base} — type a message ("exit" to quit)\n`);

for (;;) {
  const raw = await nextLine("[maya] > ");
  if (raw === null) break; // stdin ended (piped input ran out)
  const line = raw.trim();
  if (!line || line === "exit") break;
  try {
    await send({ role: "user", parts: [{ text: line }] });
  } catch (err) {
    console.error("✗", err.message);
  }
}
rl.close();
