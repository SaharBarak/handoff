import { z } from 'zod';
import { err, ok, type Result } from 'neverthrow';
import { AbsolutePath, type RemoteTarget } from './types.js';
import type { HandoffError } from './errors.js';

const RemoteTargetSchema = z.object({
  host: z.string().min(1, 'host required'),
  projectPath: z.string().refine((p) => p.startsWith('/'), 'projectPath must be absolute'),
  homePath: z
    .string()
    .refine((p) => p.startsWith('/'), 'homePath must be absolute')
    .optional(),
  claudeCmd: z.string().min(1).optional(),
  tmuxSession: z.string().min(1).optional(),
});

export const ConfigSchema = z.object({
  defaultTarget: z.string().optional(),
  targets: z.record(z.string(), RemoteTargetSchema),
});

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface HandoffConfig {
  readonly defaultTarget?: string;
  readonly targets: Readonly<Record<string, RemoteTarget>>;
}

export const parseConfig = (
  raw: unknown,
  sourcePath: string,
): Result<HandoffConfig, HandoffError> => {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return err({ kind: 'config-invalid', path: sourcePath, issues });
  }

  const targets: Record<string, RemoteTarget> = {};
  for (const [name, t] of Object.entries(parsed.data.targets)) {
    const homePath = t.homePath ?? deriveHomeFromHost(t.host);
    targets[name] = {
      name,
      host: t.host,
      projectPath: AbsolutePath(t.projectPath),
      homePath: AbsolutePath(homePath),
      claudeCmd: t.claudeCmd ?? 'claude',
      tmuxSession: t.tmuxSession ?? `handoff-${name}`,
    };
  }

  return ok({ defaultTarget: parsed.data.defaultTarget, targets });
};

const deriveHomeFromHost = (host: string): string => {
  const user = host.includes('@') ? host.split('@')[0] : 'root';
  return user === 'root' ? '/root' : `/home/${user}`;
};
