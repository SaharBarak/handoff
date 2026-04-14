/**
 * Tagged-union domain errors. Each error case carries the data needed to
 * render an actionable CLI message — no exceptions are thrown across layers,
 * everything flows through Result<T, HandoffError>.
 */

export type HandoffError =
  | { readonly kind: 'config-not-found'; readonly path: string }
  | { readonly kind: 'config-invalid'; readonly path: string; readonly issues: readonly string[] }
  | { readonly kind: 'target-unknown'; readonly name: string; readonly available: readonly string[] }
  | { readonly kind: 'not-a-git-repo'; readonly cwd: string }
  | { readonly kind: 'git-no-remote'; readonly cwd: string }
  | { readonly kind: 'git-command-failed'; readonly command: string; readonly stderr: string }
  | { readonly kind: 'session-not-found'; readonly slugDir: string }
  | { readonly kind: 'session-dir-missing'; readonly slugDir: string }
  | { readonly kind: 'rsync-failed'; readonly stderr: string }
  | { readonly kind: 'ssh-failed'; readonly host: string; readonly stderr: string }
  | { readonly kind: 'tmux-launch-failed'; readonly stderr: string }
  | { readonly kind: 'precondition-failed'; readonly reason: string };

export const formatError = (err: HandoffError): string => {
  switch (err.kind) {
    case 'config-not-found':
      return `No handoff config at ${err.path}. Run 'handoff init' or pass --host/--path.`;
    case 'config-invalid':
      return `Invalid config at ${err.path}:\n  ${err.issues.join('\n  ')}`;
    case 'target-unknown':
      return `Unknown target '${err.name}'. Available: ${err.available.join(', ') || '(none)'}`;
    case 'not-a-git-repo':
      return `${err.cwd} is not inside a git working tree.`;
    case 'git-no-remote':
      return `Repository at ${err.cwd} has no git remote configured. Add one with 'git remote add origin <url>'.`;
    case 'git-command-failed':
      return `git ${err.command} failed:\n${err.stderr}`;
    case 'session-not-found':
      return `No Claude session JSONL found in ${err.slugDir}. Are you running from inside a Claude Code session?`;
    case 'session-dir-missing':
      return `Claude session directory missing: ${err.slugDir}`;
    case 'rsync-failed':
      return `rsync failed:\n${err.stderr}`;
    case 'ssh-failed':
      return `ssh ${err.host} failed:\n${err.stderr}`;
    case 'tmux-launch-failed':
      return `Failed to start remote tmux session:\n${err.stderr}`;
    case 'precondition-failed':
      return `Precondition failed: ${err.reason}`;
  }
};
