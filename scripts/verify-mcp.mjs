// Night-1 gate verification: handshake + tool inventory + two live calls.
// Spawns the Dynatrace MCP server as a stdio child (the same way the ADK agent will).
import { connectMcp } from './mcp-client.mjs';

const client = await connectMcp('night1-verify');

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
