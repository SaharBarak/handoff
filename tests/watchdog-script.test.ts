import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WATCHDOG_SCRIPT } from '../src/infrastructure/watchdog-script.js';

const writeScript = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-watchdog-'));
  const file = join(dir, 'script.sh');
  writeFileSync(file, WATCHDOG_SCRIPT);
  return file;
};

describe('WATCHDOG_SCRIPT — hardening (post-OpenClaw review)', () => {
  it('passes bash -n syntax check', () => {
    const file = writeScript();
    expect(() => execSync(`bash -n ${file}`, { stdio: 'pipe' })).not.toThrow();
  });

  it('caps message bodies at MAX_CHARS to stay under Telegram 4096 limit', () => {
    expect(WATCHDOG_SCRIPT).toContain('MAX_CHARS=3800');
    expect(WATCHDOG_SCRIPT).toContain('truncate_body');
    expect(WATCHDOG_SCRIPT).toContain('truncated');
  });

  it('uses HTML parse mode with entity escaping for <, >, &', () => {
    expect(WATCHDOG_SCRIPT).toContain('parse_mode=HTML');
    expect(WATCHDOG_SCRIPT).toContain('html_escape');
    expect(WATCHDOG_SCRIPT).toMatch(/s\/&\/\\&amp;/);
    expect(WATCHDOG_SCRIPT).toMatch(/s\/</);
    expect(WATCHDOG_SCRIPT).toMatch(/s\/>/);
    expect(WATCHDOG_SCRIPT).toContain('<pre>');
  });

  it('rate limits to avoid telegram per-chat 1/sec cap', () => {
    expect(WATCHDOG_SCRIPT).toContain('MIN_SEND_GAP');
    expect(WATCHDOG_SCRIPT).toContain('rate_limit');
    expect(WATCHDOG_SCRIPT).toContain('LAST_SENT_FILE');
  });

  it('resets offset on log rotation / truncation (cur < last)', () => {
    expect(WATCHDOG_SCRIPT).toMatch(/if\s*\(\(\s*cur\s*<\s*last\s*\)\)/);
  });

  it('reaps stale .pos files whose .log no longer exists', () => {
    expect(WATCHDOG_SCRIPT).toContain('reap_stale_offsets');
    expect(WATCHDOG_SCRIPT).toMatch(/rm -f.*pos/);
  });

  it('escapes hostname and logdir in the startup banner', () => {
    expect(WATCHDOG_SCRIPT).toContain('hostname | html_escape');
    expect(WATCHDOG_SCRIPT).toContain('LOG_DIR" | html_escape');
  });

  it('does NOT use legacy Markdown parse mode (prone to breakage on backticks)', () => {
    expect(WATCHDOG_SCRIPT).not.toContain('parse_mode=Markdown');
  });
});
