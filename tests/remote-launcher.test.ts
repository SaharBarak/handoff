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

const baseTarget: RemoteTarget = {
  name: 'overnight',
  host: 'ubuntu@example.com',
  projectPath: AbsolutePath('/home/ubuntu/workspace/handoff'),
  homePath: AbsolutePath('/home/ubuntu'),
  claudeCmd: 'claude',
  tmuxSession: 'handoff-overnight',
  logDir: AbsolutePath('/home/ubuntu/.local/share/handoff'),
};

const target: RemoteTarget = baseTarget;

const targetWithOrchestrator: RemoteTarget = {
  ...baseTarget,
  orchestrator: {
    sessionId: SessionId('orch-session-uuid-long-enough'),
    channelsPlugin: 'plugin:telegram@claude-plugins-official',
    tmuxSession: 'handoff-orchestrator',
    secretsFile: AbsolutePath('/home/ubuntu/.config/handoff/secrets.env'),
  },
};

const targetWithWatchdog: RemoteTarget = {
  ...baseTarget,
  watchdog: {
    tmuxSession: 'handoff-watchdog',
    logDir: AbsolutePath('/home/ubuntu/.local/share/handoff'),
    patterns: ['ERROR', 'Failed'],
    pollSeconds: 15,
    tokenEnvVar: 'HANDOFF_TG_TOKEN',
    chatIdEnvVar: 'HANDOFF_TG_CHAT_ID',
    secretsFile: AbsolutePath('/home/ubuntu/.config/handoff/secrets.env'),
  },
};

const targetWithBoth: RemoteTarget = {
  ...targetWithOrchestrator,
  watchdog: targetWithWatchdog.watchdog,
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

describe('buildRemoteScript — work session only', () => {
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

  it('pipes the pane into a per-session log file', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain('tmux pipe-pane');
    expect(script).toContain('/home/ubuntu/.local/share/handoff/handoff-overnight.log');
  });

  it('creates the log dir before piping', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).toContain("mkdir -p '/home/ubuntu/.local/share/handoff'");
  });

  it('does NOT include orchestrator or watchdog blocks when not configured', () => {
    const script = buildRemoteScript(target, session, snapshot);
    expect(script).not.toContain('orchestrator');
    expect(script).not.toContain('watchdog');
    expect(script).not.toContain('--channels');
  });
});

describe('buildRemoteScript — orchestrator', () => {
  it('launches orchestrator with claude --channels flag', () => {
    const script = buildRemoteScript(targetWithOrchestrator, session, snapshot);
    expect(script).toContain('--channels');
    expect(script).toContain("'plugin:telegram@claude-plugins-official'");
    expect(script).toContain("'orch-session-uuid-long-enough'");
  });

  it('uses start-once-reuse semantics for the orchestrator', () => {
    const script = buildRemoteScript(targetWithOrchestrator, session, snapshot);
    expect(script).toContain("tmux has-session -t 'handoff-orchestrator'");
    expect(script).toContain('orchestrator already running, reusing');
    expect(script).not.toContain("tmux kill-session -t 'handoff-orchestrator'");
  });

  it('sources the secrets file before launching claude', () => {
    const script = buildRemoteScript(targetWithOrchestrator, session, snapshot);
    expect(script).toContain('/home/ubuntu/.config/handoff/secrets.env');
  });
});

describe('buildRemoteScript — watchdog', () => {
  it('writes the watchdog bash script to disk via heredoc', () => {
    const script = buildRemoteScript(targetWithWatchdog, session, snapshot);
    expect(script).toContain('HANDOFF_WATCHDOG_EOF');
    expect(script).toContain('/home/ubuntu/.local/bin/handoff-watchdog.sh');
    expect(script).toContain('chmod +x');
  });

  it('launches watchdog tmux session with start-once-reuse', () => {
    const script = buildRemoteScript(targetWithWatchdog, session, snapshot);
    expect(script).toContain("tmux has-session -t 'handoff-watchdog'");
    expect(script).toContain('watchdog already running, reusing');
  });

  it('exports log-dir, poll interval, and patterns into watchdog env', () => {
    const script = buildRemoteScript(targetWithWatchdog, session, snapshot);
    expect(script).toContain('HANDOFF_LOG_DIR=');
    expect(script).toContain('HANDOFF_WATCH_POLL=15');
    // Patterns get embedded inside the sh-escaped tmux command; just verify the
    // pattern content and the env var name both appear without overspecifying
    // the quote form (tmux's outer single-quoting wraps the already-quoted inner).
    expect(script).toMatch(/HANDOFF_WATCH_PATTERNS=.*ERROR\|Failed/);
  });

  it('sources the secrets file before exec-ing the watchdog', () => {
    const script = buildRemoteScript(targetWithWatchdog, session, snapshot);
    expect(script).toContain('/home/ubuntu/.config/handoff/secrets.env');
  });
});

describe('buildRemoteScript — combined orchestrator + watchdog', () => {
  it('emits all three blocks in order: work → orchestrator → watchdog', () => {
    const script = buildRemoteScript(targetWithBoth, session, snapshot);
    const workIdx = script.indexOf('work session');
    const orchIdx = script.indexOf('orchestrator');
    const watchIdx = script.indexOf('watchdog');
    expect(workIdx).toBeGreaterThanOrEqual(0);
    expect(orchIdx).toBeGreaterThan(workIdx);
    expect(watchIdx).toBeGreaterThan(orchIdx);
  });
});
