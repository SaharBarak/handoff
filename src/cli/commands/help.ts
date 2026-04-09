/**
 * help — prints CLI usage.
 */

const HELP = `
wellinformed — knowledge graph + research daemon Claude Code plugin

usage:
  wellinformed <command> [options]

commands (Phase 0/1):
  doctor [--fix]          check runtime prerequisites (and bootstrap with --fix)
  version                 print version
  help                    this message

commands (roadmap, not yet implemented):
  init                    interview the user and seed a room
  room <sub>              list / create / switch / current
  daemon <sub>            start / stop / status / trigger
  trigger [--room R]      run one research iteration now
  discover [--room R]     force a discovery iteration
  telegram <sub>          setup / test / capture-start / digest-test
  sources <sub>           list / add / disable / review
  report [date] [--room]  read a report
  ask "<query>"           semantic search + summarize
  mcp start               run the MCP server (spawned by Claude Code plugin)
`.trimStart();

export function printHelp(_args: string[]): number {
  process.stdout.write(HELP);
  return 0;
}
