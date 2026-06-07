// List problems through the MCP server — the same list_problems call the
// agent makes. Gate helper (TENANT_SETUP.md §5) and rehearsal probe.
// Usage: node scripts/check-problems.mjs
import { connectMcp } from './mcp-client.mjs';

const client = await connectMcp('check-problems');

const problems = await client.callTool({ name: 'list_problems', arguments: {} });
console.log(problems.content?.map((c) => c.text ?? '').join('\n'));

await client.close();
