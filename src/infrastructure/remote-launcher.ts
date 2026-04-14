import { okAsync, type ResultAsync } from 'neverthrow';
import type { HandoffError } from '../domain/errors.js';
import type { ClaudeSession, GitSnapshot, RemoteTarget } from '../domain/types.js';
import { type SshTransport, shellEscape } from './ssh-transport.js';

export interface LaunchPlan {
  readonly tmuxAttachCommand: string;
}

/**
 * Compose the remote-side bash one-liner. We separate it from execution so it
 * can be unit-tested and dry-run printed without an SSH round-trip.
 */
export const buildRemoteScript = (
  target: RemoteTarget,
  session: ClaudeSession,
  snapshot: GitSnapshot,
): string => {
  const project = shellEscape(target.projectPath);
  const branch = shellEscape(snapshot.branch);
  const tmuxName = shellEscape(target.tmuxSession);
  const claudeCmd = `${target.claudeCmd} --resume ${shellEscape(session.id)} --dangerously-skip-permissions`;

  return [
    `set -euo pipefail`,
    `cd ${project}`,
    `git fetch --all --quiet`,
    `git checkout ${branch}`,
    `if tmux has-session -t ${tmuxName} 2>/dev/null; then`,
    `  tmux kill-session -t ${tmuxName}`,
    `fi`,
    `tmux new-session -d -s ${tmuxName} ${shellEscape(claudeCmd)}`,
    `echo "handoff: tmux session ${tmuxName} started"`,
  ].join('\n');
};

export const launchRemote = (
  ssh: SshTransport,
  target: RemoteTarget,
  session: ClaudeSession,
  snapshot: GitSnapshot,
): ResultAsync<LaunchPlan, HandoffError> => {
  const script = buildRemoteScript(target, session, snapshot);
  return ssh.exec(`bash -lc ${shellEscape(script)}`).andThen(() =>
    okAsync({
      tmuxAttachCommand: `ssh -t ${target.host} tmux attach -t ${target.tmuxSession}`,
    }),
  );
};
