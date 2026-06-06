// Night-1 gate verification: handshake + tool inventory + two live calls.
// Spawns the Dynatrace MCP server as a stdio child (the same way the ADK agent will).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';

// Load .env without a dotenv dependency
const env = { ...process.env };
for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
env.DT_MCP_DISABLE_TELEMETRY = 'true'; // keep the verification run quiet; the DEMO run leaves it on so the sandbox can block it

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@dynatrace-oss/dynatrace-mcp-server'],
  env,
});

const client = new Client({ name: 'night1-verify', version: '0.0.1' });
await client.connect(transport);

console.log('== handshake OK ==');

const { tools } = await client.listTools();
console.log(`== ${tools.length} tools ==`);
for (const t of tools) console.log(`- ${t.name}`);

console.log('\n== list_problems ==');
const problems = await client.callTool({ name: 'list_problems', arguments: {} });
console.log(JSON.stringify(problems.content?.[0], null, 2).slice(0, 800));

console.log('\n== execute_dql (trivial) ==');
const dql = await client.callTool({
  name: 'execute_dql',
  arguments: { dqlStatement: 'fetch logs | limit 3' },
});
console.log(JSON.stringify(dql.content?.[0], null, 2).slice(0, 800));

await client.close();
console.log('\n== night-1 gate: PASS ==');
