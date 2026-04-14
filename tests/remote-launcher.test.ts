import { describe, it, expect } from 'vitest';
import { buildRemoteScript } from '../src/infrastructure/remote-launcher.js';
import {
  AbsolutePath,
  BranchName,
  SessionId,
  Slug,
  type ClaudeSession,
  type GitSnapshot,
  type RemoteTarget,
} from '../src/domain/types.js';

const target: RemoteTarget = {
  name: 'overnight',
  host: 'ubuntu@example.com',
  projectPath: AbsolutePath('/home/ubuntu/workspace/handoff'),
  homePath: AbsolutePath('/home/ubuntu'),
  claudeCmd: 'claude',
  tmuxSession: 'handoff-overnight',
};

const session: ClaudeSession = {
  id: SessionId('abcd-1234-uuid'),
  transcriptPath: AbsolutePath('/tmp/abcd.jsonl'),
  localSlug: Slug('-Users-x-y'),
};

const snapshot: GitSnapshot = {
  branch: BranchName('handoff/2026-04-14-12-00-00-abcd1234'),
  sourceBranch: 'main',
  commitSha: 'deadbeef',
  hadDirtyTree: true,
};

describe('buildRemoteScript', () => {
  it('contains git checkout for the handoff branch', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain("git checkout 'handoff/2026-04-14-12-00-00-abcd1234'");
  });

  it('cd into project path with single-quote escaping', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain("cd '/home/ubuntu/workspace/handoff'");
  });

  it('starts tmux detached with claude --resume + dangerous flag', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain('tmux new-session -d');
    expect(script).toContain('--resume');
    expect(script).toContain('--dangerously-skip-permissions');
  });

  it('kills any existing tmux session of the same name first', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain("tmux has-session -t 'handoff-overnight'");
    expect(script).toContain("tmux kill-session -t 'handoff-overnight'");
  });

  it('starts with set -euo pipefail', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script.startsWith('set -euo pipefail')).toBe(true);
  });
});
