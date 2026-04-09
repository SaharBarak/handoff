/**
 * doctor — checks runtime prerequisites for wellinformed.
 * Phase 0 scope: Node version, Python availability, scaffold presence.
 * Phase 1+ will add: graphify import, sqlite-vec load, embeddings model, telegram token.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
};

function checkNode(): Check {
  const required = 20;
  const major = Number(process.versions.node.split('.')[0]);
  return {
    name: 'Node.js >= 20',
    ok: major >= required,
    detail: `found ${process.versions.node}`,
    blocking: true,
  };
}

function checkPython(): Check {
  const result = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (result.status === 0) {
    const out = (result.stdout || result.stderr || '').trim();
    return { name: 'Python 3.10+', ok: true, detail: out, blocking: true };
  }
  return {
    name: 'Python 3.10+',
    ok: false,
    detail: 'python3 not found on PATH (needed for graphify sidecar)',
    blocking: true,
  };
}

function checkPluginManifest(): Check {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/commands/doctor.js -> ../../../.claude-plugin/plugin.json
  // src/cli/commands/doctor.ts -> ../../../.claude-plugin/plugin.json
  const manifest = join(here, '..', '..', '..', '.claude-plugin', 'plugin.json');
  return {
    name: 'plugin manifest',
    ok: existsSync(manifest),
    detail: existsSync(manifest) ? '.claude-plugin/plugin.json present' : 'missing .claude-plugin/plugin.json',
    blocking: false,
  };
}

function checkGraphifyVendored(): Check {
  return {
    name: 'graphify sidecar',
    ok: false,
    detail: 'not yet vendored (Phase 1 deliverable)',
    blocking: false,
  };
}

function render(c: Check): string {
  const mark = c.ok ? '[ ok ]' : c.blocking ? '[fail]' : '[skip]';
  return `${mark} ${c.name.padEnd(24)} ${c.detail}`;
}

export async function doctor(_args: string[]): Promise<number> {
  const checks: Check[] = [checkNode(), checkPython(), checkPluginManifest(), checkGraphifyVendored()];
  console.log('wellinformed doctor\n');
  for (const c of checks) console.log(render(c));
  console.log('');

  const blocking = checks.filter((c) => !c.ok && c.blocking);
  if (blocking.length === 0) {
    console.log('no blocking issues — Phase 0 scaffold is healthy.');
    return 0;
  }
  console.log(`${blocking.length} blocking issue(s). resolve before running the daemon.`);
  return 1;
}
