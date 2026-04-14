/**
 * Branded primitives and value objects for the handoff domain.
 * Branding keeps unrelated string-typed ids from being mixed at compile time.
 */

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type SessionId = Brand<string, 'SessionId'>;
export type BranchName = Brand<string, 'BranchName'>;
export type AbsolutePath = Brand<string, 'AbsolutePath'>;
export type Slug = Brand<string, 'Slug'>;

export const SessionId = (raw: string): SessionId => raw as SessionId;
export const BranchName = (raw: string): BranchName => raw as BranchName;
export const AbsolutePath = (raw: string): AbsolutePath => raw as AbsolutePath;
export const Slug = (raw: string): Slug => raw as Slug;

export interface RemoteTarget {
  readonly name: string;
  readonly host: string;
  readonly projectPath: AbsolutePath;
  readonly claudeCmd: string;
  readonly tmuxSession: string;
  readonly homePath: AbsolutePath;
}

export interface ClaudeSession {
  readonly id: SessionId;
  readonly transcriptPath: AbsolutePath;
  readonly localSlug: Slug;
}

export interface GitSnapshot {
  readonly branch: BranchName;
  readonly sourceBranch: string;
  readonly commitSha: string;
  readonly hadDirtyTree: boolean;
}

export interface HandoffOutcome {
  readonly target: RemoteTarget;
  readonly session: ClaudeSession;
  readonly snapshot: GitSnapshot;
  readonly remoteSlug: Slug;
  readonly remoteTranscriptPath: AbsolutePath;
  readonly tmuxAttachCommand: string;
}

export interface HandoffOptions {
  readonly cwd: AbsolutePath;
  readonly targetName?: string;
  readonly explicitHost?: string;
  readonly explicitPath?: string;
  readonly sessionIdOverride?: string;
  readonly dryRun: boolean;
}
