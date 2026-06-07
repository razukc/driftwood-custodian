// Run a DQL statement through the MCP server — the same execute_dql call the
// agent makes. Gate helper (TENANT_SETUP.md §5) and rehearsal probe.
// Usage: node scripts/check-dql.mjs "fetch logs | limit 3"
import { connectMcp } from './mcp-client.mjs';

const client = await connectMcp('check-dql');

const dql = await client.callTool({
  name: 'execute_dql',
  arguments: { dqlStatement: process.argv[2] ?? 'fetch logs | limit 3' },
});
console.log(dql.content?.map((c) => c.text ?? '').join('\n'));

await client.close();
