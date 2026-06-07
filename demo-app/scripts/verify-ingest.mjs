// Sends one tagged log record through the real OTLP pipeline, then prints the
// DQL that confirms arrival. Run with .env loaded:
//   node --env-file=.env scripts/verify-ingest.mjs
if (process.env.OTLP_DISABLED === "1") {
  console.error(
    "verify-ingest needs live OTLP export. With OTLP_DISABLED=1 the record is\n" +
      "dropped before export and the printed DQL can never match. Unset\n" +
      "OTLP_DISABLED and run with: node --env-file=.env scripts/verify-ingest.mjs"
  );
  process.exit(1);
}

// logger.js fail-fasts here if DT_OTLP_ENDPOINT / DT_API_TOKEN are missing —
// its error message says how to fix it; nothing to add.
const { log, shutdownLogging } = await import("../src/logger.js");

const tag = `verify-${Math.random().toString(36).slice(2, 10)}`;
log("info", `ingest verification record ${tag}`, { "verify.tag": tag });
await shutdownLogging(); // flushes the batch

console.log(`
Sent one tagged record. Confirm arrival (allow ~1-2 min ingest lag) in a tenant
notebook — or via the MCP server's execute_dql — with:

  fetch logs
  | filter verify.tag == "${tag}"
  | fields timestamp, content, verify.tag
`);
