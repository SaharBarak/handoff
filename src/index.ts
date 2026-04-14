#!/usr/bin/env node
import { buildCli } from './cli/commands.js';

const main = async (): Promise<void> => {
  const cli = buildCli();
  await cli.parseAsync(process.argv);
};

main().catch((e: unknown) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
