import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../src/application/target-resolver.js';
import { AbsolutePath, type RemoteTarget } from '../src/domain/types.js';
import type { HandoffConfig } from '../src/domain/config.js';

const sampleTarget: RemoteTarget = {
  name: 'overnight',
  host: 'ubuntu@host',
  projectPath: AbsolutePath('/home/ubuntu/workspace/handoff'),
  homePath: AbsolutePath('/home/ubuntu'),
  claudeCmd: 'claude',
  tmuxSession: 'handoff-overnight',
  logDir: AbsolutePath('/home/ubuntu/.local/share/handoff'),
};

const sampleConfig: HandoffConfig = {
  defaultTarget: 'overnight',
  targets: { overnight: sampleTarget },
};

describe('resolveTarget', () => {
  it('returns ad-hoc target when host+path provided', () => {
    const r = resolveTarget(null, {
      explicitHost: 'me@srv',
      explicitPath: '/srv/proj',
    });
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.name).toBe('ad-hoc');
    expect(r.value.host).toBe('me@srv');
    expect(r.value.projectPath).toBe('/srv/proj');
  });

  it('uses defaultTarget when no name given', () => {
    const r = resolveTarget(sampleConfig, {});
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.name).toBe('overnight');
  });

  it('uses single target as fallback when no default and one target exists', () => {
    const r = resolveTarget({ targets: { only: sampleTarget } }, {});
    expect(r.isOk()).toBe(true);
  });

  it('errors when target name is unknown', () => {
    const r = resolveTarget(sampleConfig, { name: 'missing' });
    expect(r.isErr()).toBe(true);
    if (!r.isErr()) return;
    expect(r.error.kind).toBe('target-unknown');
  });

  it('errors when no config and no host/path', () => {
    const r = resolveTarget(null, {});
    expect(r.isErr()).toBe(true);
    if (!r.isErr()) return;
    expect(r.error.kind).toBe('precondition-failed');
  });
});
