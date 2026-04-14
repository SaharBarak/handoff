import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { join } from 'node:path';
import { AbsolutePath, type ClaudeSession, type HandoffOutcome, type HandoffOptions, type RemoteTarget } from '../domain/types.js';
import { slugifyPath } from '../domain/slug.js';
import type { HandoffError } from '../domain/errors.js';
import type { HandoffConfig } from '../domain/config.js';
import type { Logger } from '../infrastructure/logger.js';
import {
  captureAndPushSnapshot,
  ensureGitRepo,
  ensureRemoteConfigured,
} from '../infrastructure/git-transfer.js';
import { findActiveSession } from '../infrastructure/claude-session.js';
import { resolveTarget } from './target-resolver.js';
import type { SshTransport } from '../infrastructure/ssh-transport.js';
import { launchRemote } from '../infrastructure/remote-launcher.js';

export interface HandoffPorts {
  readonly logger: Logger;
  readonly makeSsh: (host: string) => SshTransport;
  readonly findSession: typeof findActiveSession;
  readonly captureSnapshot: typeof captureAndPushSnapshot;
  readonly checkGitRepo: typeof ensureGitRepo;
  readonly checkGitRemote: typeof ensureRemoteConfigured;
  readonly launchRemote: typeof launchRemote;
}

const remoteTranscriptDestination = (target: RemoteTarget, session: ClaudeSession): {
  remoteSlug: ReturnType<typeof slugifyPath>;
  remoteDir: string;
  remotePath: string;
} => {
  const remoteSlug = slugifyPath(target.projectPath);
  const remoteDir = join(target.homePath, '.claude', 'projects', remoteSlug);
  const remotePath = join(remoteDir, `${session.id}.jsonl`);
  return { remoteSlug, remoteDir, remotePath };
};

/**
 * Orchestrates the handoff pipeline. Each step is a Result-returning function;
 * andThen chains them without throwing, preserving typed errors all the way to
 * the CLI surface where they get pretty-printed.
 */
export const executeHandoff = (
  ports: HandoffPorts,
  config: HandoffConfig | null,
  options: HandoffOptions,
): ResultAsync<HandoffOutcome, HandoffError> => {
  const { logger } = ports;

  const targetResult = resolveTarget(config, {
    name: options.targetName,
    explicitHost: options.explicitHost,
    explicitPath: options.explicitPath,
  });
  if (targetResult.isErr()) return errAsync(targetResult.error);
  const target = targetResult.value;
  logger.step(`target: ${target.name} (${target.host}:${target.projectPath})`);

  return ports
    .checkGitRepo({ cwd: options.cwd })
    .andThen(() => ports.checkGitRemote({ cwd: options.cwd }))
    .andThen(() => {
      logger.step('locating active Claude session');
      return ports.findSession(options.cwd, options.sessionIdOverride);
    })
    .andThen((session) => {
      logger.info(`session ${session.id}`);
      if (options.dryRun) {
        return dryRunOutcome(target, session, ports);
      }
      return runFullPipeline(target, session, ports, options.cwd);
    });
};

const dryRunOutcome = (
  target: RemoteTarget,
  session: ClaudeSession,
  ports: HandoffPorts,
): ResultAsync<HandoffOutcome, HandoffError> => {
  ports.logger.warn('dry-run: skipping git push, rsync, and remote launch');
  const { remoteSlug, remotePath } = remoteTranscriptDestination(target, session);
  return okAsync({
    target,
    session,
    snapshot: {
      branch: 'handoff/dry-run' as never,
      sourceBranch: 'unknown',
      commitSha: '0000000',
      hadDirtyTree: false,
    },
    remoteSlug,
    remoteTranscriptPath: AbsolutePath(remotePath),
    tmuxAttachCommand: `ssh -t ${target.host} tmux attach -t ${target.tmuxSession}`,
  });
};

const runFullPipeline = (
  target: RemoteTarget,
  session: ClaudeSession,
  ports: HandoffPorts,
  cwd: string,
): ResultAsync<HandoffOutcome, HandoffError> => {
  const { logger } = ports;
  const ssh = ports.makeSsh(target.host);
  const { remoteSlug, remoteDir, remotePath } = remoteTranscriptDestination(target, session);

  logger.step('snapshotting working tree to handoff branch');
  return ports
    .captureSnapshot(cwd, session.id)
    .andThen((snapshot) => {
      logger.info(`pushed ${snapshot.branch} (dirty=${snapshot.hadDirtyTree})`);
      logger.step(`syncing transcript to ${target.host}`);
      return ssh
        .ensureRemoteDir(remoteDir)
        .andThen(() => ssh.rsync(session.transcriptPath, remotePath))
        .map(() => snapshot);
    })
    .andThen((snapshot) => {
      logger.step('starting tmux session on remote');
      return ports
        .launchRemote(ssh, target, session, snapshot)
        .map((plan) => ({
          target,
          session,
          snapshot,
          remoteSlug,
          remoteTranscriptPath: AbsolutePath(remotePath),
          tmuxAttachCommand: plan.tmuxAttachCommand,
        }));
    });
};
