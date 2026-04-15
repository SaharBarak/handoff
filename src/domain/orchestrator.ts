import { z } from 'zod';
import { AbsolutePath, SessionId, type Slug } from './types.js';

/**
 * Orchestrator: a long-lived `claude --resume <id> --channels ...` session running on the
 * remote. You message it through Telegram (Anthropic's first-party Channels plugin) and it
 * uses its shell tools (tmux capture-pane, send-keys, tail) to inspect and command the
 * other handoff work sessions on the same machine. First-party, sanctioned, no harness.
 */
export interface OrchestratorConfig {
  readonly sessionId: SessionId;
  readonly channelsPlugin: string;
  readonly tmuxSession: string;
  readonly secretsFile: AbsolutePath;
}

/**
 * Watchdog: a tiny bash daemon (no Claude involvement) that tails the per-session log
 * files in <logDir> and posts pattern matches to a Telegram chat via plain curl. Pure
 * push notifications, complementary to the orchestrator's interactive flow.
 */
export interface WatchdogConfig {
  readonly tmuxSession: string;
  readonly logDir: AbsolutePath;
  readonly patterns: readonly string[];
  readonly pollSeconds: number;
  readonly tokenEnvVar: string;
  readonly chatIdEnvVar: string;
  readonly secretsFile: AbsolutePath;
}

const OrchestratorSchema = z.object({
  sessionId: z.string().min(8, 'orchestrator.sessionId required'),
  channelsPlugin: z.string().min(1).optional(),
  tmuxSession: z.string().min(1).optional(),
  secretsFile: z.string().refine((p) => p.startsWith('/'), 'secretsFile must be absolute').optional(),
});

const WatchdogSchema = z.object({
  tmuxSession: z.string().min(1).optional(),
  logDir: z.string().refine((p) => p.startsWith('/'), 'logDir must be absolute').optional(),
  patterns: z.array(z.string().min(1)).optional(),
  pollSeconds: z.number().int().positive().optional(),
  tokenEnvVar: z.string().min(1).optional(),
  chatIdEnvVar: z.string().min(1).optional(),
});

export const RawOrchestratorSchema = z
  .object({
    orchestrator: OrchestratorSchema.optional(),
    watchdog: WatchdogSchema.optional(),
  })
  .partial();

export type RawOrchestratorBlock = z.infer<typeof RawOrchestratorSchema>;

const DEFAULT_CHANNELS_PLUGIN = 'plugin:telegram@claude-plugins-official';
const DEFAULT_PATTERNS = ['ERROR', 'Traceback', 'FATAL', 'panic:', 'segfault'];
const DEFAULT_POLL_SECONDS = 30;

export const buildOrchestratorConfig = (
  raw: z.infer<typeof OrchestratorSchema> | undefined,
  remoteHome: string,
): OrchestratorConfig | undefined => {
  if (!raw) return undefined;
  return {
    sessionId: SessionId(raw.sessionId),
    channelsPlugin: raw.channelsPlugin ?? DEFAULT_CHANNELS_PLUGIN,
    tmuxSession: raw.tmuxSession ?? 'handoff-orchestrator',
    secretsFile: AbsolutePath(raw.secretsFile ?? `${remoteHome}/.config/handoff/secrets.env`),
  };
};

export const buildWatchdogConfig = (
  raw: z.infer<typeof WatchdogSchema> | undefined,
  remoteHome: string,
): WatchdogConfig | undefined => {
  if (!raw) return undefined;
  return {
    tmuxSession: raw.tmuxSession ?? 'handoff-watchdog',
    logDir: AbsolutePath(raw.logDir ?? `${remoteHome}/.local/share/handoff`),
    patterns: raw.patterns ?? DEFAULT_PATTERNS,
    pollSeconds: raw.pollSeconds ?? DEFAULT_POLL_SECONDS,
    tokenEnvVar: raw.tokenEnvVar ?? 'HANDOFF_TG_TOKEN',
    chatIdEnvVar: raw.chatIdEnvVar ?? 'HANDOFF_TG_CHAT_ID',
    secretsFile: AbsolutePath(`${remoteHome}/.config/handoff/secrets.env`),
  };
};

// Re-export the slug type so other modules touching log-dir naming have access.
export type { Slug };
