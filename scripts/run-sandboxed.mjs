#!/usr/bin/env node

// Launch wrapper for the capgate-sandboxed driftwood-agent.
// Reads policy.docker.json, assembles docker run command, mounts the gateway network.

import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Load compiled Docker policy
const policyPath = resolve(repoRoot, 'policy', 'policy.docker.json');
if (!existsSync(policyPath)) {
  console.error(`✗ Policy not found: ${policyPath}`);
  console.error('Run: capgate compile policy/manifest.json --target docker --pretty > policy/policy.docker.json');
  process.exit(1);
}

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
console.log(`[run-sandboxed] loaded policy: ${policy.argv.length} argv items, ${policy.egress.length} egress endpoints`);

// Ensure gateway container is running
// (in a real demo, this would be started before the agent; for now we assume it's up)

// Assemble docker run command from policy
const imageName = 'driftwood-custodian:latest';
const args = ['run', '--interactive', '--tty', '--rm'];

// Add argv from policy (caps, security opts, mounts, etc.)
args.push(...policy.argv);

// Add env injections from policy (DT_*, GOOGLE_CLOUD_*)
// These come from repo-root .env, set via --env-file or explicit -e
if (process.env.DT_ENVIRONMENT) {
  args.push('-e', `DT_ENVIRONMENT=${process.env.DT_ENVIRONMENT}`);
}
if (process.env.DT_PLATFORM_TOKEN) {
  args.push('-e', `DT_PLATFORM_TOKEN=${process.env.DT_PLATFORM_TOKEN}`);
}
if (process.env.GOOGLE_CLOUD_PROJECT) {
  args.push('-e', `GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`);
}
if (process.env.GOOGLE_CLOUD_LOCATION) {
  args.push('-e', `GOOGLE_CLOUD_LOCATION=${process.env.GOOGLE_CLOUD_LOCATION}`);
}

// Network: attach to egress-gateway for task 0 lane (a) enforcement
// or skip if --network host is needed; the policy.notes say: don't use --network host
const gatewayContainerId = process.env.EGRESS_GATEWAY_ID;
if (gatewayContainerId) {
  args.push('--network', `container:${gatewayContainerId}`);
  console.log(`[run-sandboxed] attached to egress-gateway container: ${gatewayContainerId}`);
} else {
  console.log('[run-sandboxed] ⚠ EGRESS_GATEWAY_ID not set; agent will use default bridge network (egress not enforced)');
}

// Volume: mount policy file for the gateway to read (already mounted via argv)
// Volume: mount demo app config if present
args.push('--volume', `${repoRoot}/policy/policy.docker.json:/policy/policy.docker.json:ro`);

// Image and initial command (piped from stdin)
args.push(imageName);

// If arguments provided, they become the agent prompt
if (process.argv.slice(2).length > 0) {
  args.push(process.argv.slice(2).join(' '));
}

console.log(`\n[run-sandboxed] launching:\ndocker ${args.join(' ')}\n`);

// Spawn docker run
const child = spawn('docker', args, {
  stdio: 'inherit',
  cwd: repoRoot,
});

process.on('SIGINT', () => {
  console.log('\n[run-sandboxed] interrupted (Ctrl+C)');
  child.kill('SIGTERM');
});

child.on('exit', (code) => {
  process.exit(code);
});
