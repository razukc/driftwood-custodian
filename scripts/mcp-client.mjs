// Shared stdio client for the Dynatrace MCP server. Used by the gate/agent
// helper scripts; the ADK agent spawns the server the same way.
// Env: repo-root .env with DT_ENVIRONMENT + DT_PLATFORM_TOKEN (gitignored).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';

export async function connectMcp(name) {
  const env = { ...process.env };
  let envFile;
  try {
    envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    throw new Error(
      'missing repo-root .env — create it with DT_ENVIRONMENT and DT_PLATFORM_TOKEN ' +
        '(see policy/manifest.json for the declared env surface)'
    );
  }
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  // Helper runs stay quiet; the DEMO run leaves telemetry on so the sandbox can block it.
  env.DT_MCP_DISABLE_TELEMETRY = 'true';

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@dynatrace-oss/dynatrace-mcp-server'],
    env,
  });

  const client = new Client({ name, version: '0.0.1' });
  await client.connect(transport);
  return client;
}
