/**
 * version — prints the current package name + version.
 * Reads from package.json at runtime so bumps are picked up automatically.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function version(): number {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/commands/version.js -> ../../../package.json
  // src/cli/commands/version.ts -> ../../../package.json
  const pkgPath = join(here, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };
  console.log(`${pkg.name} ${pkg.version}`);
  return 0;
}
