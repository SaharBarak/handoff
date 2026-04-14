import { execa } from 'execa';
import { ResultAsync } from 'neverthrow';
import type { HandoffError } from '../domain/errors.js';

export interface SshTransport {
  rsync: (localPath: string, remotePath: string) => ResultAsync<void, HandoffError>;
  exec: (command: string) => ResultAsync<string, HandoffError>;
  ensureRemoteDir: (remotePath: string) => ResultAsync<void, HandoffError>;
}

export const createSshTransport = (host: string): SshTransport => ({
  rsync: (local, remote) =>
    ResultAsync.fromPromise(
      // No --mkpath: old rsync (macOS system 2.6.9) rejects it. The orchestrator
      // calls ensureRemoteDir before every rsync so the target dir already exists.
      execa('rsync', ['-az', local, `${host}:${remote}`]).then(() => undefined),
      (e): HandoffError => ({
        kind: 'rsync-failed',
        stderr: (e as { stderr?: string }).stderr ?? String(e),
      }),
    ),

  exec: (command) =>
    ResultAsync.fromPromise(
      execa('ssh', [host, command]).then((r) => r.stdout),
      (e): HandoffError => ({
        kind: 'ssh-failed',
        host,
        stderr: (e as { stderr?: string }).stderr ?? String(e),
      }),
    ),

  ensureRemoteDir: (remotePath) =>
    ResultAsync.fromPromise(
      execa('ssh', [host, `mkdir -p ${shellEscape(remotePath)}`]).then(() => undefined),
      (e): HandoffError => ({
        kind: 'ssh-failed',
        host,
        stderr: (e as { stderr?: string }).stderr ?? String(e),
      }),
    ),
});

/**
 * Single-quote shell escape — wraps in '...' and replaces any inner ' with '\''.
 * Used to safely interpolate paths into remote commands.
 */
export const shellEscape = (raw: string): string => `'${raw.replace(/'/g, `'\\''`)}'`;
