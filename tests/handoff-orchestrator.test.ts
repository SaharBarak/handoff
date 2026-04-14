import { describe, it, expect, vi } from 'vitest';
import { errAsync, okAsync } from 'neverthrow';
import { executeHandoff, type HandoffPorts } from '../src/application/handoff.js';
import {
  AbsolutePath,
  BranchName,
  SessionId,
  Slug,
  type ClaudeSession,
  type GitSnapshot,
  type RemoteTarget,
} from '../src/domain/types.js';
import type { HandoffConfig } from '../src/domain/config.js';

const target: RemoteTarget = {
  name: 'overnight',
  host: 'ubuntu@example.com',
  projectPath: AbsolutePath('/home/ubuntu/workspace/handoff'),
  homePath: AbsolutePath('/home/ubuntu'),
  claudeCmd: 'claude',
  tmuxSession: 'handoff-overnight',
  logDir: AbsolutePath('/home/ubuntu/.local/share/handoff'),
};

const session: ClaudeSession = {
  id: SessionId('sess-uuid-1'),
  transcriptPath: AbsolutePath('/Users/x/.claude/projects/-Users-x-proj/sess-uuid-1.jsonl'),
  localSlug: Slug('-Users-x-proj'),
};

const snapshot: GitSnapshot = {
  branch: BranchName('handoff/2026-04-14-12-00-00-sess'),
  sourceBranch: 'main',
  commitSha: 'abc123',
  hadDirtyTree: true,
};

const config: HandoffConfig = {
  defaultTarget: 'overnight',
  targets: { overnight: target },
};

const buildMockPorts = (overrides: Partial<HandoffPorts> = {}): HandoffPorts => {
  const ssh = {
    rsync: vi.fn(() => okAsync(undefined)),
    exec: vi.fn(() => okAsync('ok')),
    ensureRemoteDir: vi.fn(() => okAsync(undefined)),
  };
  const logger = {
    step: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger,
    makeSsh: () => ssh,
    findSession: vi.fn(() => okAsync(session)),
    captureSnapshot: vi.fn(() => okAsync(snapshot)),
    checkGitRepo: vi.fn(() => okAsync(undefined)),
    checkGitRemote: vi.fn(() => okAsync(undefined)),
    launchRemote: vi.fn(() =>
      okAsync({
        tmuxAttachCommand: 'ssh -t ubuntu@example.com tmux attach -t handoff-overnight',
      }),
    ),
    ...overrides,
  };
};

describe('executeHandoff', () => {
  it('runs the full pipeline and returns outcome', async () => {
    const ports = buildMockPorts();
    const result = await executeHandoff(ports, config, {
      cwd: AbsolutePath('/Users/x/proj'),
      dryRun: false,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.target.name).toBe('overnight');
    expect(result.value.snapshot.branch).toContain('handoff/');
    expect(result.value.tmuxAttachCommand).toContain('tmux attach');

    expect(ports.checkGitRepo).toHaveBeenCalled();
    expect(ports.checkGitRemote).toHaveBeenCalled();
    expect(ports.findSession).toHaveBeenCalled();
    expect(ports.captureSnapshot).toHaveBeenCalled();
    expect(ports.launchRemote).toHaveBeenCalled();
  });

  it('skips push and remote launch in dry-run mode', async () => {
    const ports = buildMockPorts();
    const result = await executeHandoff(ports, config, {
      cwd: AbsolutePath('/Users/x/proj'),
      dryRun: true,
    });

    expect(result.isOk()).toBe(true);
    expect(ports.captureSnapshot).not.toHaveBeenCalled();
    expect(ports.launchRemote).not.toHaveBeenCalled();
  });

  it('aborts when not in a git repo', async () => {
    const ports = buildMockPorts({
      checkGitRepo: vi.fn(() => errAsync({ kind: 'not-a-git-repo', cwd: '/x' })),
    });
    const result = await executeHandoff(ports, config, {
      cwd: AbsolutePath('/x'),
      dryRun: false,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.kind).toBe('not-a-git-repo');
    expect(ports.findSession).not.toHaveBeenCalled();
  });

  it('aborts when no remote configured', async () => {
    const ports = buildMockPorts({
      checkGitRemote: vi.fn(() => errAsync({ kind: 'git-no-remote', cwd: '/x' })),
    });
    const result = await executeHandoff(ports, config, {
      cwd: AbsolutePath('/x'),
      dryRun: false,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.kind).toBe('git-no-remote');
  });

  it('errors with target-unknown when name does not exist', async () => {
    const ports = buildMockPorts();
    const result = await executeHandoff(ports, config, {
      cwd: AbsolutePath('/x'),
      targetName: 'nope',
      dryRun: false,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.kind).toBe('target-unknown');
  });
});
