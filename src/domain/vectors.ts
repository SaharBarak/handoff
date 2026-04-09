/**
 * Pure domain model for dense vector math + semantic matches.
 *
 * This module owns the vocabulary around embeddings — Vector, Match,
 * Tunnel — plus the pure linear-algebra helpers the rest of the stack
 * builds on. No persistence, no async, no classes.
 *
 * Dimension is a phantom-friendly opaque type so callers can't
 * accidentally mix a 384-dim MiniLM vector with a 768-dim BGE vector
 * without us noticing at the boundary.
 */

import { Result, err, ok } from 'neverthrow';
import { VectorError } from './errors.js';
import type { NodeId, Room, Wing } from './graph.js';

/** Canonical embedding dimension for Xenova/all-MiniLM-L6-v2. */
export const DEFAULT_DIM = 384;

/** A dense unit-normalized float32 vector. */
export type Vector = Float32Array;

/** A vector in context — carries the id, room, and wing of its node. */
export interface VectorRecord {
  readonly node_id: NodeId;
  readonly room: Room;
  readonly wing?: Wing;
  readonly vector: Vector;
}

/** A similarity match returned by a search. `distance` is L2 on unit vectors. */
export interface Match {
  readonly node_id: NodeId;
  readonly room: Room;
  readonly wing?: Wing;
  readonly distance: number;
}

/** A pair of nodes from different rooms with a short semantic distance. */
export interface Tunnel {
  readonly a: NodeId;
  readonly b: NodeId;
  readonly room_a: Room;
  readonly room_b: Room;
  readonly distance: number;
}

// ─────────────────────── validation ───────────────────────

/** Verify a vector matches the expected dimension. */
export const assertDim = (v: Vector, expected: number = DEFAULT_DIM): Result<Vector, VectorError> =>
  v.length === expected ? ok(v) : err(VectorError.dimensionMismatch(expected, v.length));

// ─────────────────────── arithmetic ───────────────────────

/** L2 (Euclidean) distance between two equal-length vectors. */
export const l2 = (a: Vector, b: Vector): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
};

/** Cosine similarity — assumes both vectors are already unit-normalized. */
export const cosine = (a: Vector, b: Vector): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Return a new unit-normalized copy of the input vector. */
export const normalize = (v: Vector): Vector => {
  let sumsq = 0;
  for (let i = 0; i < v.length; i++) sumsq += v[i] * v[i];
  const norm = Math.sqrt(sumsq) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
};

/**
 * Build a unit vector from a sparse list of (index, value) pairs.
 * Useful for tests that want control over specific dimensions.
 */
export const sparse = (entries: readonly (readonly [number, number])[], dim = DEFAULT_DIM): Vector => {
  const v = new Float32Array(dim);
  for (const [i, x] of entries) v[i] = x;
  return normalize(v);
};

// ─────────────────────── tunnel detection ────────────────

/**
 * Find cross-room tunnel candidates — pairs of records from different
 * rooms with L2 distance ≤ threshold.
 *
 * Pure function: no I/O, no mutation. The caller passes a snapshot of
 * all vector records it cares about, and this returns a sorted list.
 *
 * Complexity: O(n²) in the number of records passed. For Phase 1
 * volumes (hundreds) this is fine. Later phases can swap in a
 * nearest-neighbours search driven by the vector index.
 */
export const findTunnels = (
  records: readonly VectorRecord[],
  threshold: number,
  restrictToRoom?: Room,
): readonly Tunnel[] => {
  const tunnels: Tunnel[] = [];
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (restrictToRoom && a.room !== restrictToRoom) continue;
    for (let j = i + 1; j < records.length; j++) {
      const b = records[j];
      if (a.room === b.room) continue; // same room is not a tunnel
      const d = l2(a.vector, b.vector);
      if (d <= threshold) {
        tunnels.push({
          a: a.node_id,
          b: b.node_id,
          room_a: a.room,
          room_b: b.room,
          distance: d,
        });
      }
    }
  }
  return tunnels.sort((x, y) => x.distance - y.distance);
};
