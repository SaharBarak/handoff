import { okAsync, type ResultAsync } from 'neverthrow';
import type { HandoffError } from '../domain/errors.js';
import type { ClaudeSession, GitSnapshot, RemoteTarget } from '../domain/types.js';
import type { OrchestratorConfig, WatchdogConfig } from '../domain/orchestrator.js';
import { type SshTransport, shellEscape } from './ssh-transport.js';
import { WATCHDOG_SCRIPT } from './watchdog-script.js';

export interface LaunchPlan {
  readonly tmuxAttachCommand: string;
  readonly orchestratorAttachCommand?: string;
  readonly watchdogAttachCommand?: string;
}

const buildWorkSessionBlock = (target: RemoteTarget, session: ClaudeSession): readonly string[] => {
  const project = shellEscape(target.projectPath);
  const tmuxName = shellEscape(target.tmuxSession);
  const logDir = shellEscape(target.logDir);
  const logFile = shellEscape(`${target.logDir}/${target.tmuxSession}.log`);
  const claudeCmd = `${target.claudeCmd} --resume ${shellEscape(session.id)} --dangerously-skip-permissions`;

  return [
    `# --- work session ---`,
    `mkdir -p ${logDir}`,
    `cd ${project}`,
    `if tmux has-session -t ${tmuxName} 2>/dev/null; then`,
    `  tmux kill-session -t ${tmuxName}`,
    `fi`,
    `tmux new-session -d -s ${tmuxName} ${shellEscape(claudeCmd)}`,
    // pipe-pane needs the session to exist; small grace window before piping
    `sleep 0.3`,
    `tmux pipe-pane -o -t ${tmuxName} ${shellEscape(`cat >> ${target.logDir}/${target.tmuxSession}.log`)}`,
    `: > ${logFile} || true`,
  ];
};

const buildOrchestratorBlock = (
  target: RemoteTarget,
  orch: OrchestratorConfig,
): readonly string[] => {
  const tmuxName = shellEscape(orch.tmuxSession);
  const project = shellEscape(target.projectPath);
  const secrets = shellEscape(orch.secretsFile);
  const claudeCmd = [
    target.claudeCmd,
    '--resume',
    shellEscape(orch.sessionId),
    '--channels',
    shellEscape(orch.channelsPlugin),
    '--dangerously-skip-permissions',
  ].join(' ');
  // Source secrets (chat id / token) so the orchestrator's claude has them available too,
  // in case the user wires the orchestrator to call out to other tools that need them.
  // exec replaces the shell with claude so the tmux pane PID is claude itself.
  const launch = `set -a; [ -f ${secrets} ] && . ${secrets}; set +a; cd ${project}; exec ${claudeCmd}`;
  return [
    `# --- orchestrator (start-once-reuse) ---`,
    `if tmux has-session -t ${tmuxName} 2>/dev/null; then`,
    `  echo "handoff: orchestrator already running, reusing"`,
    `else`,
    `  tmux new-session -d -s ${tmuxName} ${shellEscape(launch)}`,
    `fi`,
  ];
};

const buildWatchdogBlock = (
  target: RemoteTarget,
  watch: WatchdogConfig,
): readonly string[] => {
  const tmuxName = shellEscape(watch.tmuxSession);
  const logDir = shellEscape(target.logDir);
  const secrets = shellEscape(watch.secretsFile);
  const scriptPath = `${target.homePath}/.local/bin/handoff-watchdog.sh`;
  const scriptPathQ = shellEscape(scriptPath);
  // Semicolon-separated so tmux's default shell runs each statement directly without
  // needing an explicit bash -lc wrapper (which double-escapes quoted args).
  const launch = [
    `set -a`,
    `[ -f ${secrets} ] && . ${secrets}`,
    `set +a`,
    `export HANDOFF_LOG_DIR=${logDir}`,
    `export HANDOFF_WATCH_POLL=${watch.pollSeconds}`,
    `export HANDOFF_WATCH_PATTERNS=${shellEscape(watch.patterns.join('|'))}`,
    `exec bash ${scriptPathQ}`,
  ].join('; ');

  return [
    `# --- watchdog (start-once-reuse) ---`,
    `mkdir -p ${shellEscape(`${target.homePath}/.local/bin`)}`,
    `cat > ${scriptPathQ} <<'HANDOFF_WATCHDOG_EOF'`,
    WATCHDOG_SCRIPT,
    `HANDOFF_WATCHDOG_EOF`,
    `chmod +x ${scriptPathQ}`,
    `if tmux has-session -t ${tmuxName} 2>/dev/null; then`,
    `  echo "handoff: watchdog already running, reusing"`,
    `else`,
    `  tmux new-session -d -s ${tmuxName} ${shellEscape(launch)}`,
    `fi`,
  ];
};

/**
 * Compose the remote-side bash script. Three logical blocks: the work session (always),
 * the orchestrator (if configured), and the watchdog (if configured). Orchestrator and
 * watchdog use start-once-reuse semantics so multiple handoffs to the same target share
 * one orchestrator and one watchdog.
 */
export const buildRemoteScript = (
  target: RemoteTarget,
  session: ClaudeSession,
  snapshot: GitSnapshot,
): string => {
  const branch = shellEscape(snapshot.branch);
  const project = shellEscape(target.projectPath);

  const lines: string[] = [
    `set -euo pipefail`,
    `cd ${project}`,
    `git fetch --all --quiet`,
    `git checkout ${branch}`,
    ``,
    ...buildWorkSessionBlock(target, session),
  ];

  if (target.orchestrator) {
    lines.push(``, ...buildOrchestratorBlock(target, target.orchestrator));
  }

  if (target.watchdog) {
    lines.push(``, ...buildWatchdogBlock(target, target.watchdog));
  }

  lines.push(``, `echo "handoff: tmux session ${target.tmuxSession} started"`);
  return lines.join('\n');
};

export const launchRemote = (
  ssh: SshTransport,
  target: RemoteTarget,
  session: ClaudeSession,
  snapshot: GitSnapshot,
): ResultAsync<LaunchPlan, HandoffError> => {
  const script = buildRemoteScript(target, session, snapshot);
  return ssh.exec(`bash -lc ${shellEscape(script)}`).andThen(() => {
    const plan: LaunchPlan = {
      tmuxAttachCommand: `ssh -t ${target.host} tmux attach -t ${target.tmuxSession}`,
      orchestratorAttachCommand: target.orchestrator
        ? `ssh -t ${target.host} tmux attach -t ${target.orchestrator.tmuxSession}`
        : undefined,
      watchdogAttachCommand: target.watchdog
        ? `ssh -t ${target.host} tmux attach -t ${target.watchdog.tmuxSession}`
        : undefined,
    };
    return okAsync(plan);
  });
};
