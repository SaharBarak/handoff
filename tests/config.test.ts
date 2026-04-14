import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/domain/config.js';

describe('parseConfig', () => {
  it('parses a minimal valid config and applies defaults', () => {
    const result = parseConfig(
      {
        targets: {
          overnight: {
            host: 'ubuntu@example.com',
            projectPath: '/home/ubuntu/workspace/handoff',
          },
        },
      },
      '/fake/path.json',
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const t = result.value.targets['overnight']!;
    expect(t.host).toBe('ubuntu@example.com');
    expect(t.projectPath).toBe('/home/ubuntu/workspace/handoff');
    expect(t.homePath).toBe('/home/ubuntu');
    expect(t.claudeCmd).toBe('claude');
    expect(t.tmuxSession).toBe('handoff-overnight');
  });

  it('derives homePath for root user', () => {
    const result = parseConfig(
      { targets: { x: { host: 'root@host', projectPath: '/srv/x' } } },
      'p',
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.targets['x']!.homePath).toBe('/root');
  });

  it('rejects relative projectPath', () => {
    const result = parseConfig(
      { targets: { x: { host: 'h', projectPath: 'relative' } } },
      'p',
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.kind).toBe('config-invalid');
  });

  it('rejects empty host', () => {
    const result = parseConfig({ targets: { x: { host: '', projectPath: '/x' } } }, 'p');
    expect(result.isErr()).toBe(true);
  });

  it('parses orchestrator + watchdog block and applies defaults', () => {
    const result = parseConfig(
      {
        targets: {
          overnight: {
            host: 'ubuntu@example.com',
            projectPath: '/home/ubuntu/workspace/handoff',
            orchestrator: {
              sessionId: 'orch-session-uuid-long-enough',
            },
            watchdog: {},
          },
        },
      },
      'p',
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const t = result.value.targets['overnight']!;
    expect(t.logDir).toBe('/home/ubuntu/.local/share/handoff');
    expect(t.orchestrator).toBeDefined();
    expect(t.orchestrator?.sessionId).toBe('orch-session-uuid-long-enough');
    expect(t.orchestrator?.channelsPlugin).toBe('plugin:telegram@claude-plugins-official');
    expect(t.orchestrator?.tmuxSession).toBe('handoff-orchestrator');
    expect(t.watchdog).toBeDefined();
    expect(t.watchdog?.tmuxSession).toBe('handoff-watchdog');
    expect(t.watchdog?.pollSeconds).toBe(30);
    expect(t.watchdog?.patterns).toContain('ERROR');
  });

  it('omits orchestrator + watchdog when not present in raw config', () => {
    const result = parseConfig(
      {
        targets: {
          x: { host: 'root@h', projectPath: '/srv/x' },
        },
      },
      'p',
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const t = result.value.targets['x']!;
    expect(t.orchestrator).toBeUndefined();
    expect(t.watchdog).toBeUndefined();
    expect(t.logDir).toBe('/root/.local/share/handoff');
  });

  it('rejects orchestrator with missing sessionId', () => {
    const result = parseConfig(
      {
        targets: {
          x: {
            host: 'h',
            projectPath: '/x',
            orchestrator: {},
          },
        },
      },
      'p',
    );
    expect(result.isErr()).toBe(true);
  });
});
