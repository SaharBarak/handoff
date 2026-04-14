import { err, ok, type Result } from 'neverthrow';
import type { HandoffConfig } from '../domain/config.js';
import { AbsolutePath, type RemoteTarget } from '../domain/types.js';
import type { HandoffError } from '../domain/errors.js';

export interface TargetSelector {
  readonly name?: string;
  readonly explicitHost?: string;
  readonly explicitPath?: string;
}

/**
 * Resolution rules:
 *   - explicitHost+explicitPath → ad-hoc target, no config required
 *   - selector.name             → look up by name in config
 *   - else                      → fall back to config.defaultTarget
 *   - if config has exactly one target, use it
 */
export const resolveTarget = (
  config: HandoffConfig | null,
  selector: TargetSelector,
): Result<RemoteTarget, HandoffError> => {
  if (selector.explicitHost && selector.explicitPath) {
    return ok({
      name: 'ad-hoc',
      host: selector.explicitHost,
      projectPath: AbsolutePath(selector.explicitPath),
      homePath: AbsolutePath(deriveHome(selector.explicitHost)),
      claudeCmd: 'claude',
      tmuxSession: 'handoff-adhoc',
    });
  }

  if (!config) {
    return err({
      kind: 'precondition-failed',
      reason: 'no config and no --host/--path provided',
    });
  }

  const available = Object.keys(config.targets);
  const name = selector.name ?? config.defaultTarget ?? (available.length === 1 ? available[0] : undefined);

  if (!name) {
    return err({ kind: 'target-unknown', name: '<unset>', available });
  }

  const target = config.targets[name];
  if (!target) {
    return err({ kind: 'target-unknown', name, available });
  }
  return ok(target);
};

const deriveHome = (host: string): string => {
  const user = host.includes('@') ? host.split('@')[0] : 'root';
  return user === 'root' ? '/root' : `/home/${user}`;
};
