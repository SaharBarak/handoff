import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { AbsolutePath, type HandoffOptions } from '../domain/types.js';
import { formatError } from '../domain/errors.js';
import { createLogger } from '../infrastructure/logger.js';
import { loadConfig, defaultConfigPath } from '../infrastructure/config-loader.js';
import { findActiveSession } from '../infrastructure/claude-session.js';
import {
  captureAndPushSnapshot,
  ensureGitRepo,
  ensureRemoteConfigured,
} from '../infrastructure/git-transfer.js';
import { createSshTransport } from '../infrastructure/ssh-transport.js';
import { launchRemote } from '../infrastructure/remote-launcher.js';
import { executeHandoff, type HandoffPorts } from '../application/handoff.js';

const VERSION = '0.1.0';

const buildPorts = (verbose: boolean): HandoffPorts => ({
  logger: createLogger(verbose),
  makeSsh: createSshTransport,
  findSession: findActiveSession,
  captureSnapshot: captureAndPushSnapshot,
  checkGitRepo: ensureGitRepo,
  checkGitRemote: ensureRemoteConfigured,
  launchRemote,
});

const runHandoff = async (
  targetName: string | undefined,
  opts: {
    host?: string;
    path?: string;
    session?: string;
    dryRun?: boolean;
    verbose?: boolean;
    config?: string;
  },
): Promise<number> => {
  const ports = buildPorts(opts.verbose ?? false);
  const cwd = AbsolutePath(process.cwd());

  const configResult = await loadConfig(opts.config);
  const config = configResult.isOk() ? configResult.value : null;
  if (configResult.isErr() && configResult.error.kind !== 'config-not-found') {
    ports.logger.error(formatError(configResult.error));
    return 1;
  }

  const handoffOptions: HandoffOptions = {
    cwd,
    targetName,
    explicitHost: opts.host,
    explicitPath: opts.path,
    sessionIdOverride: opts.session,
    dryRun: opts.dryRun ?? false,
  };

  const result = await executeHandoff(ports, config, handoffOptions);

  if (result.isErr()) {
    ports.logger.error(formatError(result.error));
    return 1;
  }

  const out = result.value;
  ports.logger.info(`handoff complete`);
  process.stdout.write(`\n  branch:    ${out.snapshot.branch}\n`);
  process.stdout.write(`  remote:    ${out.target.host}:${out.target.projectPath}\n`);
  process.stdout.write(`  session:   ${out.session.id}\n`);
  process.stdout.write(`  attach:    ${out.tmuxAttachCommand}\n`);
  if (out.target.orchestrator) {
    process.stdout.write(
      `  orch:      ssh -t ${out.target.host} tmux attach -t ${out.target.orchestrator.tmuxSession}\n`,
    );
  }
  if (out.target.watchdog) {
    process.stdout.write(
      `  watchdog:  ssh -t ${out.target.host} tmux attach -t ${out.target.watchdog.tmuxSession}\n`,
    );
  }
  process.stdout.write(`\n`);
  return 0;
};

const runInit = async (): Promise<number> => {
  const path = defaultConfigPath();
  if (existsSync(path)) {
    process.stdout.write(`config already exists at ${path}\n`);
    return 0;
  }
  await mkdir(dirname(path), { recursive: true });
  const sample = {
    defaultTarget: 'overnight',
    targets: {
      overnight: {
        host: 'ubuntu@my-remote.example.com',
        projectPath: '/home/ubuntu/workspace/handoff',
        homePath: '/home/ubuntu',
        claudeCmd: 'claude',
        tmuxSession: 'handoff-overnight',
      },
    },
  };
  await writeFile(path, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote sample config to ${path}\nedit it, then run: handoff\n`);
  return 0;
};

export const buildCli = (): Command => {
  const program = new Command();
  program
    .name('handoff')
    .description('Transfer a Claude Code session to a remote machine to continue overnight work')
    .version(VERSION);

  program
    .argument('[target]', 'name of a target from config (defaults to defaultTarget or only target)')
    .option('--host <host>', 'ad-hoc remote host (e.g., user@example.com), requires --path')
    .option('--path <path>', 'absolute project path on remote')
    .option('--session <id>', 'override session id (defaults to current session or most recent)')
    .option('--config <file>', 'config file path')
    .option('--dry-run', 'plan only, do not push or launch')
    .option('-v, --verbose', 'verbose logging')
    .action(async (target, opts) => {
      process.exitCode = await runHandoff(target, opts);
    });

  program
    .command('init')
    .description('write a sample config to ~/.config/handoff/config.json')
    .action(async () => {
      process.exitCode = await runInit();
    });

  return program;
};
