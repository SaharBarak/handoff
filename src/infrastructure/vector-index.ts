/**
 * VectorIndex — port + sqlite-vec adapter.
 *
 * The port is a narrow capability interface: anything that can upsert
 * a vector record, search globally, search by room, and enumerate all
 * records (for offline passes like tunnel detection).
 *
 * The adapter `sqliteVectorIndex` is backed by better-sqlite3 +
 * sqlite-vec 0.1.x. Room filtering uses an auxiliary `vec_meta` table
 * joined against the `vec0` virtual table, because the npm-packaged
 * 0.1.x doesn't consistently expose partition keys across platforms.
 *
 * Single responsibility: it indexes vectors and answers proximity
 * queries. It does NOT know about tunnels — that's pure domain logic
 * in `src/domain/vectors.ts`. This file just provides the raw records.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type Database from 'better-sqlite3';
import { VectorError } from '../domain/errors.js';
import type { Match, Vector, VectorRecord } from '../domain/vectors.js';
import { DEFAULT_DIM } from '../domain/vectors.js';
import type { NodeId, Room, Wing } from '../domain/graph.js';

/** Port — the application layer depends on this. */
export interface VectorIndex {
  upsert(record: VectorRecord): ResultAsync<void, VectorError>;
  searchGlobal(query: Vector, k: number): ResultAsync<readonly Match[], VectorError>;
  searchByRoom(room: Room, query: Vector, k: number): ResultAsync<readonly Match[], VectorError>;
  /** Snapshot of every record — used by offline passes like tunnel detection. */
  all(): ResultAsync<readonly VectorRecord[], VectorError>;
  size(): number;
  close(): void;
}

/** Configuration for the sqlite adapter. */
export interface SqliteVectorIndexOptions {
  readonly path: string;
  readonly dim?: number;
  /**
   * searchByRoom implementation detail — how many extra candidates to
   * pull from the global KNN before filtering down to one room.
   * Defaults to 10 (so searchByRoom(k=5) probes the global top-50).
   */
  readonly roomSearchOverfetch?: number;
}

/** Lazily open a sqlite-vec backed VectorIndex. */
export const openSqliteVectorIndex = (
  opts: SqliteVectorIndexOptions,
): ResultAsync<VectorIndex, VectorError> => {
  const dim = opts.dim ?? DEFAULT_DIM;
  const overfetch = opts.roomSearchOverfetch ?? 10;

  return ResultAsync.fromPromise(
    (async () => {
      mkdirSync(dirname(opts.path), { recursive: true });
      const firstTime = !existsSync(opts.path);

      const [Better, vec] = await Promise.all([import('better-sqlite3'), import('sqlite-vec')]);
      const DatabaseCtor = (Better as unknown as { default: typeof Database }).default;
      const db = new DatabaseCtor(opts.path);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      vec.load(db);

      if (firstTime) {
        db.exec(`CREATE VIRTUAL TABLE vec_nodes USING vec0(embedding float[${dim}])`);
        db.exec(`CREATE TABLE IF NOT EXISTS vec_meta (
          rowid   INTEGER PRIMARY KEY,
          node_id TEXT    UNIQUE NOT NULL,
          room    TEXT    NOT NULL,
          wing    TEXT,
          created INTEGER NOT NULL
        )`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_vec_meta_room ON vec_meta(room)`);
      }

      return build(db, dim, overfetch);
    })(),
    (e) => VectorError.openError(opts.path, (e as Error).message),
  );
};

// ─────────────────────── implementation ───────────────────

const build = (db: Database.Database, dim: number, overfetch: number): VectorIndex => {
  // sqlite-vec's vec0 virtual table rejects `INSERT OR REPLACE` because
  // the internal storage treats the rowid as an immutable key. The
  // supported upsert pattern is: DELETE by rowid (no-op if absent)
  // followed by a plain INSERT inside a single transaction.
  const stDeleteVec = db.prepare('DELETE FROM vec_nodes WHERE rowid = ?');
  const stInsertVec = db.prepare('INSERT INTO vec_nodes(rowid, embedding) VALUES (?, ?)');
  const stUpsertMeta = db.prepare(
    'INSERT OR REPLACE INTO vec_meta(rowid, node_id, room, wing, created) VALUES (?, ?, ?, ?, ?)',
  );
  const stGetRowid = db.prepare('SELECT rowid FROM vec_meta WHERE node_id = ?');
  const stCount = db.prepare('SELECT COUNT(*) AS n FROM vec_meta');
  const stMaxRowid = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM vec_meta');
  const stAllMeta = db.prepare('SELECT rowid, node_id, room, wing FROM vec_meta ORDER BY rowid');
  const stAllVectors = db.prepare('SELECT rowid, embedding FROM vec_nodes');
  // sqlite-vec requires the k value on the MATCH clause itself
  // (`k = ?`), not as a trailing LIMIT. LIMIT is evaluated AFTER the
  // vec0 scan, so using it alone makes sqlite-vec reject the prepare.
  const stSearch = db.prepare(
    `SELECT m.node_id, m.room, m.wing, v.distance
     FROM vec_nodes v
     JOIN vec_meta  m ON v.rowid = m.rowid
     WHERE v.embedding MATCH ? AND k = ?
     ORDER BY v.distance`,
  );

  const upsert = (record: VectorRecord): ResultAsync<void, VectorError> => {
    if (record.vector.length !== dim) {
      return errAsync(VectorError.dimensionMismatch(dim, record.vector.length));
    }
    try {
      const existing = stGetRowid.get(record.node_id) as { rowid: number } | undefined;
      const rowid = BigInt(existing?.rowid ?? (stMaxRowid.get() as { m: number }).m + 1);
      const buf = toVecBuffer(record.vector);
      const tx = db.transaction(() => {
        // delete any prior vector for this rowid (no-op if absent)
        stDeleteVec.run(rowid);
        stInsertVec.run(rowid, buf);
        stUpsertMeta.run(rowid, record.node_id, record.room, record.wing ?? null, Date.now());
      });
      tx();
      return okAsync(undefined);
    } catch (e) {
      return errAsync(VectorError.writeError(record.node_id, (e as Error).message));
    }
  };

  const searchGlobal = (query: Vector, k: number): ResultAsync<readonly Match[], VectorError> => {
    if (query.length !== dim) return errAsync(VectorError.dimensionMismatch(dim, query.length));
    try {
      const rows = stSearch.all(toVecBuffer(query), k) as Array<{
        node_id: NodeId;
        room: Room;
        wing: Wing | null;
        distance: number;
      }>;
      const matches: readonly Match[] = rows.map((r) => ({
        node_id: r.node_id,
        room: r.room,
        wing: r.wing ?? undefined,
        distance: r.distance,
      }));
      return okAsync(matches);
    } catch (e) {
      return errAsync(VectorError.readError((e as Error).message));
    }
  };

  const searchByRoom = (
    room: Room,
    query: Vector,
    k: number,
  ): ResultAsync<readonly Match[], VectorError> =>
    searchGlobal(query, k * overfetch).map((all) => {
      const filtered = all.filter((m) => m.room === room);
      return filtered.slice(0, k);
    });

  const all = (): ResultAsync<readonly VectorRecord[], VectorError> => {
    try {
      const metas = stAllMeta.all() as Array<{
        rowid: number;
        node_id: NodeId;
        room: Room;
        wing: Wing | null;
      }>;
      const vectors = stAllVectors.all() as Array<{ rowid: number; embedding: Buffer }>;
      const vecByRow = new Map<number, Vector>();
      for (const v of vectors) vecByRow.set(v.rowid, fromVecBuffer(v.embedding, dim));
      const records: readonly VectorRecord[] = metas
        .map((m) => {
          const vec = vecByRow.get(m.rowid);
          if (!vec) return null;
          const record: VectorRecord = {
            node_id: m.node_id,
            room: m.room,
            wing: m.wing ?? undefined,
            vector: vec,
          };
          return record;
        })
        .filter((r): r is VectorRecord => r !== null);
      return okAsync(records);
    } catch (e) {
      return errAsync(VectorError.readError((e as Error).message));
    }
  };

  const size = (): number => {
    const r = stCount.get() as { n: number };
    return r.n;
  };

  const close = (): void => {
    db.close();
  };

  return { upsert, searchGlobal, searchByRoom, all, size, close };
};

// ─────────────────────── helpers ──────────────────────────

const toVecBuffer = (v: Vector): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

const fromVecBuffer = (buf: Buffer, dim: number): Vector => {
  const out = new Float32Array(dim);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < dim; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
};
