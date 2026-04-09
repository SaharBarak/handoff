#!/usr/bin/env node
/**
 * wellinformed CLI — subcommand router (zero runtime dependencies).
 * Phase 0: doctor, version, help. Later phases add: init, room, daemon, trigger,
 * discover, telegram, sources, report, ask, mcp.
 */

import { doctor } from './commands/doctor.js';
import { version } from './commands/version.js';
import { printHelp } from './commands/help.js';

type CommandFn = (args: string[]) => Promise<number> | number;

const commands: Record<string, CommandFn> = {
  doctor,
  version,
  '--version': version,
  '-v': version,
  help: printHelp,
  '--help': printHelp,
  '-h': printHelp,
};

const futureCommands = new Set([
  'init',
  'room',
  'daemon',
  'trigger',
  'discover',
  'telegram',
  'sources',
  'report',
  'ask',
  'mcp',
]);

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    printHelp([]);
    return 0;
  }
  const handler = commands[cmd];
  if (handler) {
    return (await handler(rest)) ?? 0;
  }
  if (futureCommands.has(cmd)) {
    console.error(`wellinformed: '${cmd}' is recognized but not yet implemented (Phase 0 scaffold).`);
    console.error(`               see the roadmap — it lands in a later phase.`);
    return 2;
  }
  console.error(`wellinformed: unknown command '${cmd}'. run 'wellinformed help'.`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('wellinformed: fatal error');
    console.error(err);
    process.exit(1);
  });
