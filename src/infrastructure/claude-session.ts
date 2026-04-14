import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { AbsolutePath, SessionId, type ClaudeSession } from '../domain/types.js';
import { slugifyPath } from '../domain/slug.js';
import type { HandoffError } from '../domain/errors.js';

const sessionsRoot = (): string => join(homedir(), '.claude', 'projects');

const sessionDirFor = (cwd: string): string => join(sessionsRoot(), slugifyPath(cwd));

/**
 * Locate the active session for a working directory. Strategy:
 *   1) honour explicit override (e.g. --session or CLAUDE_SESSION_ID)
 *   2) honour CLAUDE_SESSION_ID env var (set inside hooks/slash commands)
 *   3) fall back to the most-recently-modified <id>.jsonl in the slug dir
 */
export const findActiveSession = (
  cwd: string,
  override?: string,
): ResultAsync<ClaudeSession, HandoffError> => {
  const slugDir = sessionDirFor(cwd);
  if (!existsSync(slugDir)) {
    return errAsync({ kind: 'session-dir-missing', slugDir });
  }

  const explicit = override ?? process.env['CLAUDE_SESSION_ID'];
  if (explicit) {
    return loadSession(slugDir, explicit, cwd);
  }

  return findMostRecentJsonl(slugDir).andThen((id) => loadSession(slugDir, id, cwd));
};

const loadSession = (
  slugDir: string,
  id: string,
  cwd: string,
): ResultAsync<ClaudeSession, HandoffError> => {
  const transcript = join(slugDir, `${id}.jsonl`);
  if (!existsSync(transcript)) {
    return errAsync({ kind: 'session-not-found', slugDir });
  }
  return okAsync({
    id: SessionId(id),
    transcriptPath: AbsolutePath(transcript),
    localSlug: slugifyPath(cwd),
  });
};

const findMostRecentJsonl = (slugDir: string): ResultAsync<string, HandoffError> => {
  const op = (async (): Promise<string> => {
    const entries = await readdir(slugDir);
    const jsonls = entries.filter((e) => e.endsWith('.jsonl'));
    if (jsonls.length === 0) throw new Error('no jsonl');

    const stamped = await Promise.all(
      jsonls.map(async (name) => ({
        name,
        mtime: (await stat(join(slugDir, name))).mtimeMs,
      })),
    );
    stamped.sort((a, b) => b.mtime - a.mtime);
    return stamped[0]!.name.replace(/\.jsonl$/, '');
  })();

  return ResultAsync.fromPromise(
    op,
    (): HandoffError => ({ kind: 'session-not-found', slugDir }),
  );
};

