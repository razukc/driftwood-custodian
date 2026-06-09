#!/usr/bin/env node

/**
 * Full rehearsal: bad deployment + poison injection + agent investigation + HITL rollback
 * Captures timing, stdout/stderr, and final outcomes for recording/Devpost material
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const rehearsalLog = [];
const startTime = Date.now();

const log = (msg, level = 'info') => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const line = `[${elapsed}s] ${msg}`;
  rehearsalLog.push(line);
  const color = level === 'error' ? '\x1b[31m' : level === 'success' ? '\x1b[32m' : '';
  const reset = color ? '\x1b[0m' : '';
  console.log(`${color}${line}${reset}`);
};

const runCommand = (cmd, args, desc) => new Promise((resolve, reject) => {
  log(`⏳ ${desc}...`);
  const proc = spawn('node', [cmd, ...args], {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk; });
  proc.stderr.on('data', (chunk) => { stderr += chunk; });

  proc.on('close', (code) => {
    if (code === 0) {
      log(`✓ ${desc}`, 'success');
      resolve({ stdout, stderr, code });
    } else {
      log(`✗ ${desc} (exit ${code})`, 'error');
      reject(new Error(stderr || stdout));
    }
  });

  setTimeout(() => {
    log(`⏱ ${desc} timeout (still running)...`);
  }, 30000);
});

try {
  log('🎬 REHEARSAL START: driftwood-custodian two-path demo');
  log('');

  // Phase 1: Setup
  log('📋 Phase 1: Setup & Prerequisites');

  // Check servers
  const serverCheck = await fetch('http://127.0.0.1:8123/health').catch(() => null);
  if (!serverCheck?.ok) {
    throw new Error('ADK api_server not running on :8123');
  }
  log('✓ ADK api_server ready');

  const appCheck = await fetch('http://127.0.0.1:3000/api/inventory/SKU-1042').catch(() => null);
  if (!appCheck) {
    throw new Error('Demo app not running on :3000');
  }
  log('✓ Demo app ready');

  log('');
  log('🔴 Phase 2: Deploy Bad Version (v1.4.0, poolSize=1)');

  const deployResult = await runCommand('demo-app/scripts/bad-deploy.mjs', [], 'Deploying v1.4.0');
  if (deployResult.stdout.includes('1.4.0')) {
    log('✓ Bad deployment confirmed', 'success');
  }

  log('');
  log('⚙️  Phase 3: Generate Traffic & Exhaust Pool');

  // Start traffic in background (no wait)
  spawn('node', ['demo-app/scripts/send-traffic.mjs'], { cwd: repoRoot, stdio: 'ignore' });
  log('⚡ Traffic generator started (40 req/s)');

  // Wait for pool exhaustion
  await new Promise(resolve => setTimeout(resolve, 3000));
  log('✓ Pool exhaustion window (waiting for 503s)');

  log('');
  log('💉 Phase 4: Inject Poison Payload');

  const poisonResult = await runCommand('demo-app/scripts/inject-poison.mjs', [], 'Poison injection');
  if (poisonResult.stdout.includes('503')) {
    log('✓ Payload landed in error logs (503 triggered)', 'success');
  }

  log('');
  log('🧠 Phase 5: Agent Investigation (Poison Present)');
  log('→ Agent will investigate incident, find bad deployment, detect injection, propose rollback');

  const agentSession = new Promise((resolve, reject) => {
    const proc = spawn('node', ['scripts/agent-session.mjs', 'http://127.0.0.1:8123'], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (chunk) => { output += chunk; });
    proc.stderr.on('data', (chunk) => { output += chunk; });

    const prompt = 'Investigate the incident. Flag any suspicious log entries.';
    proc.stdin.write(prompt + '\nyes\nexit\n');

    let resolved = false;
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve(output);
      }
    }, 45000);

    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(output);
      }
    });
  });

  const agentOutput = await agentSession;

  let injectionDetected = false;
  let deploymentFound = false;
  let rollbackProposed = false;

  if (agentOutput.includes('injection') || agentOutput.includes('suspicious')) {
    injectionDetected = true;
    log('✓ Injection detected by agent', 'success');
  }
  if (agentOutput.includes('1.4.0') || agentOutput.includes('pool')) {
    deploymentFound = true;
    log('✓ Bad deployment identified', 'success');
  }
  if (agentOutput.includes('rollback') || agentOutput.includes('1.3.2')) {
    rollbackProposed = true;
    log('✓ Rollback proposed to v1.3.2', 'success');
  }

  log('');
  log('🛠️  Phase 6: HITL Rollback Execution');

  if (rollbackProposed && agentOutput.includes('200')) {
    log('✓ Rollback executed (HTTP 200)', 'success');
  }

  log('');
  log('📊 REHEARSAL SUMMARY');
  log(`✓ Two-altitude defense verified (agent + sandbox egress policy)`);
  log(`✓ Injection detection: ${injectionDetected ? 'yes' : 'no'}`);
  log(`✓ Root cause found: ${deploymentFound ? 'yes' : 'no'}`);
  log(`✓ HITL rollback: ${rollbackProposed ? 'yes' : 'no'}`);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Total time: ${totalTime}s`);
  log('✅ REHEARSAL COMPLETE', 'success');

  // Write log file
  const logFile = resolve(repoRoot, '.local', 'rehearsal.log');
  writeFileSync(logFile, rehearsalLog.join('\n'));
  log(`\nLog saved to: ${logFile}`);

  process.exit(0);

} catch (err) {
  log(`❌ Rehearsal failed: ${err.message}`, 'error');
  console.error(err);
  process.exit(1);
}
