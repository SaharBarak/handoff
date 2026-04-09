/**
 * `wellinformed trigger [--room <room>]` — run one research iteration.
 *
 * Loops over the enabled sources for the room (or every room, if
 * --room is omitted), runs the ingest pipeline, and prints a
 * human-readable summary of the SourceRun counts.
 *
 * On success: exit 0. On any fatal error: exit 1. Per-source errors
 * are shown in the report and do NOT abort the batch.
 */

import { formatError } from '../../domain/errors.js';
import type { RoomRun, SourceRun } from '../../domain/sources.js';
import { triggerRoom } from '../../application/ingest.js';
import { defaultRuntime } from '../runtime.js';

interface ParsedArgs {
  readonly room?: string;
}

const parseArgs = (args: readonly string[]): ParsedArgs => {
  const out: { room?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--room' && i + 1 < args.length) {
      out.room = args[i + 1];
      i++;
    } else if (a.startsWith('--room=')) {
      out.room = a.slice('--room='.length);
    }
  }
  return out;
};

const renderRun = (run: SourceRun): string => {
  const tag = run.error ? '[fail]' : '[ ok ]';
  const base = `  ${tag} ${run.source_id.padEnd(28)} ${run.kind.padEnd(14)} seen=${String(run.items_seen).padStart(3)} new=${String(run.items_new).padStart(3)} upd=${String(run.items_updated).padStart(3)} skip=${String(run.items_skipped).padStart(3)}`;
  if (run.error) return `${base}\n         err: ${formatError(run.error)}`;
  return base;
};

const renderRoomRun = (room: RoomRun): string => {
  const lines = [`room=${room.room}  sources=${room.runs.length}`];
  for (const r of room.runs) lines.push(renderRun(r));
  return lines.join('\n');
};

export const trigger = async (args: readonly string[]): Promise<number> => {
  const parsed = parseArgs(args);

  const rt = await defaultRuntime();
  if (rt.isErr()) {
    console.error(`trigger: ${formatError(rt.error)}`);
    return 1;
  }
  const runtime = rt.value;

  try {
    // Load the full descriptor list once. If --room is provided,
    // only that room runs; otherwise iterate every distinct room in
    // the sources config.
    const listed = await runtime.sources.list();
    if (listed.isErr()) {
      console.error(`trigger: ${formatError(listed.error)}`);
      return 1;
    }
    const rooms = parsed.room
      ? [parsed.room]
      : Array.from(new Set(listed.value.map((d) => d.room)));

    if (rooms.length === 0) {
      console.log('trigger: no sources configured — use `wellinformed sources add` to seed one.');
      return 0;
    }

    let hadError = false;
    for (const room of rooms) {
      const result = await triggerRoom(runtime.ingestDeps)(room);
      if (result.isErr()) {
        hadError = true;
        console.error(`trigger: room=${room} — ${formatError(result.error)}`);
        continue;
      }
      console.log(renderRoomRun(result.value));
      if (result.value.runs.some((r) => r.error !== undefined)) hadError = true;
    }

    return hadError ? 1 : 0;
  } finally {
    runtime.close();
  }
};
