import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { parseConfig, type HandoffConfig } from '../domain/config.js';
import type { HandoffError } from '../domain/errors.js';

export const defaultConfigPath = (): string =>
  process.env['HANDOFF_CONFIG'] ?? join(homedir(), '.config', 'handoff', 'config.json');

export const loadConfig = (path?: string): ResultAsync<HandoffConfig, HandoffError> => {
  const resolved = path ?? defaultConfigPath();
  if (!existsSync(resolved)) {
    return errAsync({ kind: 'config-not-found', path: resolved });
  }
  return ResultAsync.fromPromise(
    readFile(resolved, 'utf8').then((c) => JSON.parse(c) as unknown),
    (e): HandoffError => ({
      kind: 'config-invalid',
      path: resolved,
      issues: [String(e)],
    }),
  ).andThen((raw) => {
    const parsed = parseConfig(raw, resolved);
    return parsed.isOk() ? okAsync(parsed.value) : errAsync(parsed.error);
  });
};
