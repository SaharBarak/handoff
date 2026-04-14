import { Slug } from './types.js';

/**
 * Claude Code stores per-project session JSONL files at
 *   ~/.claude/projects/<slug>/<session-id>.jsonl
 * where <slug> is the absolute project path with every '/' replaced by '-'.
 * A leading '/' becomes a leading '-', so /Users/foo/bar becomes -Users-foo-bar.
 */
export const slugifyPath = (absolutePath: string): Slug => {
  if (!absolutePath.startsWith('/')) {
    throw new Error(`slugifyPath requires absolute path, got: ${absolutePath}`);
  }
  return Slug(absolutePath.replace(/\//g, '-'));
};
