/**
 * Tiny structured logger. Avoids the pino/winston dependency footprint —
 * we only need three levels and color-tagged prefixes.
 */

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
} as const;

export interface Logger {
  step: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

const useColor = process.stdout.isTTY && process.env['NO_COLOR'] === undefined;
const c = (color: keyof typeof ANSI, text: string): string =>
  useColor ? `${ANSI[color]}${text}${ANSI.reset}` : text;

export const createLogger = (verbose: boolean): Logger => ({
  step: (msg) => process.stdout.write(`${c('cyan', '→')} ${msg}\n`),
  info: (msg) => process.stdout.write(`${c('green', '✓')} ${msg}\n`),
  warn: (msg) => process.stdout.write(`${c('yellow', '!')} ${msg}\n`),
  error: (msg) => process.stderr.write(`${c('red', '✗')} ${msg}\n`),
  debug: (msg) => {
    if (verbose) process.stdout.write(`${c('dim', `· ${msg}`)}\n`);
  },
});
