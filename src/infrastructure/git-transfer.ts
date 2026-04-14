import { execa } from 'execa';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { BranchName, type GitSnapshot, type SessionId } from '../domain/types.js';
import type { HandoffError } from '../domain/errors.js';

interface GitContext {
  readonly cwd: string;
}

const runGit = (
  ctx: GitContext,
  args: readonly string[],
): ResultAsync<string, HandoffError> => {
  return ResultAsync.fromPromise(
    execa('git', [...args], { cwd: ctx.cwd }).then((r) => r.stdout.trim()),
    (e): HandoffError => {
      const stderr = (e as { stderr?: string }).stderr ?? String(e);
      return { kind: 'git-command-failed', command: args.join(' '), stderr };
    },
  );
};

export const ensureGitRepo = (ctx: GitContext): ResultAsync<void, HandoffError> =>
  runGit(ctx, ['rev-parse', '--is-inside-work-tree']).andThen((out) =>
    out === 'true'
      ? okAsync<void, HandoffError>(undefined)
      : errAsync<void, HandoffError>({ kind: 'not-a-git-repo', cwd: ctx.cwd }),
  );

export const ensureRemoteConfigured = (ctx: GitContext): ResultAsync<void, HandoffError> =>
  runGit(ctx, ['remote']).andThen((out) =>
    out.length > 0
      ? okAsync<void, HandoffError>(undefined)
      : errAsync<void, HandoffError>({ kind: 'git-no-remote', cwd: ctx.cwd }),
  );

const currentBranch = (ctx: GitContext): ResultAsync<string, HandoffError> =>
  runGit(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']).map((s) => (s === 'HEAD' ? 'detached' : s));

const stashCreate = (ctx: GitContext): ResultAsync<string, HandoffError> =>
  runGit(ctx, ['stash', 'create', '-u', 'handoff snapshot']);

const headSha = (ctx: GitContext): ResultAsync<string, HandoffError> =>
  runGit(ctx, ['rev-parse', 'HEAD']).orElse(() => okAsync(''));

const buildBranchName = (sessionId: SessionId): BranchName => {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
  const shortSession = sessionId.slice(0, 8);
  return BranchName(`handoff/${stamp}-${shortSession}`);
};

const remoteName = (ctx: GitContext): ResultAsync<string, HandoffError> =>
  runGit(ctx, ['remote']).map((out) => out.split('\n')[0] ?? 'origin');

/**
 * Capture working tree (tracked + untracked) into a branch and push it.
 * Uses `git stash create -u` so the working directory and current branch are
 * left completely untouched. If there are no changes, the snapshot is HEAD.
 */
export const captureAndPushSnapshot = (
  cwd: string,
  sessionId: SessionId,
): ResultAsync<GitSnapshot, HandoffError> => {
  const ctx: GitContext = { cwd };
  const branch = buildBranchName(sessionId);

  return currentBranch(ctx).andThen((sourceBranch) =>
    stashCreate(ctx).andThen((stashed) =>
      (stashed.length > 0 ? okAsync(stashed) : headSha(ctx)).andThen((targetSha) => {
        if (targetSha === '') {
          return errAsync<GitSnapshot, HandoffError>({
            kind: 'precondition-failed',
            reason: 'repo has no commits yet — make at least one commit before handoff',
          });
        }
        const hadDirty = stashed.length > 0;
        return runGit(ctx, ['branch', branch, targetSha])
          .andThen(() => remoteName(ctx))
          .andThen((remote) => runGit(ctx, ['push', remote, branch]).map(() => remote))
          .map<GitSnapshot>(() => ({
            branch,
            sourceBranch,
            commitSha: targetSha,
            hadDirtyTree: hadDirty,
          }));
      }),
    ),
  );
};
