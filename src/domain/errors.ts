/**
 * Domain errors for the wellinformed knowledge graph.
 *
 * Every error is a tagged union member with a `type` discriminator plus
 * enough context for a caller to render a useful message. No `Error`
 * instances, no `throw` — errors flow through neverthrow's `Result` and
 * `ResultAsync`, so they are values you compose, not exceptions.
 *
 * The three families mirror the three bounded contexts:
 *
 *   - `GraphError`      — node/edge validation, missing references, I/O
 *   - `VectorError`     — dimension mismatch, sqlite/sqlite-vec failures
 *   - `EmbeddingError`  — transformers runtime, model load, inference
 *
 * A fourth union `AppError` combines them so use cases can return a
 * single error type across layers without losing specificity.
 */

// ─────────────────────── GraphError ───────────────────────

export type GraphError =
  | { readonly type: 'InvalidNode'; readonly field: string; readonly node_id?: string }
  | { readonly type: 'InvalidEdge'; readonly field: string }
  | { readonly type: 'NodeNotFound'; readonly node_id: string }
  | { readonly type: 'DanglingEdge'; readonly source: string; readonly target: string }
  | { readonly type: 'GraphReadError'; readonly path: string; readonly message: string }
  | { readonly type: 'GraphWriteError'; readonly path: string; readonly message: string }
  | { readonly type: 'GraphParseError'; readonly path: string; readonly message: string };

export const GraphError = {
  invalidNode: (field: string, node_id?: string): GraphError => ({ type: 'InvalidNode', field, node_id }),
  invalidEdge: (field: string): GraphError => ({ type: 'InvalidEdge', field }),
  nodeNotFound: (node_id: string): GraphError => ({ type: 'NodeNotFound', node_id }),
  danglingEdge: (source: string, target: string): GraphError => ({ type: 'DanglingEdge', source, target }),
  readError: (path: string, message: string): GraphError => ({ type: 'GraphReadError', path, message }),
  writeError: (path: string, message: string): GraphError => ({ type: 'GraphWriteError', path, message }),
  parseError: (path: string, message: string): GraphError => ({ type: 'GraphParseError', path, message }),
} as const;

// ─────────────────────── VectorError ──────────────────────

export type VectorError =
  | { readonly type: 'DimensionMismatch'; readonly expected: number; readonly got: number }
  | { readonly type: 'VectorOpenError'; readonly path: string; readonly message: string }
  | { readonly type: 'VectorWriteError'; readonly node_id: string; readonly message: string }
  | { readonly type: 'VectorReadError'; readonly message: string };

export const VectorError = {
  dimensionMismatch: (expected: number, got: number): VectorError => ({
    type: 'DimensionMismatch',
    expected,
    got,
  }),
  openError: (path: string, message: string): VectorError => ({ type: 'VectorOpenError', path, message }),
  writeError: (node_id: string, message: string): VectorError => ({
    type: 'VectorWriteError',
    node_id,
    message,
  }),
  readError: (message: string): VectorError => ({ type: 'VectorReadError', message }),
} as const;

// ─────────────────────── EmbeddingError ───────────────────

export type EmbeddingError =
  | { readonly type: 'ModelLoadError'; readonly model: string; readonly message: string }
  | { readonly type: 'InferenceError'; readonly message: string };

export const EmbeddingError = {
  modelLoad: (model: string, message: string): EmbeddingError => ({ type: 'ModelLoadError', model, message }),
  inference: (message: string): EmbeddingError => ({ type: 'InferenceError', message }),
} as const;

// ─────────────────────── AppError union ───────────────────

export type AppError = GraphError | VectorError | EmbeddingError;

/** Render a tagged error as a one-line human-readable string. */
export const formatError = (e: AppError): string => {
  switch (e.type) {
    case 'InvalidNode':
      return `invalid node: missing '${e.field}'${e.node_id ? ` (id=${e.node_id})` : ''}`;
    case 'InvalidEdge':
      return `invalid edge: missing '${e.field}'`;
    case 'NodeNotFound':
      return `node not found: ${e.node_id}`;
    case 'DanglingEdge':
      return `dangling edge: ${e.source} → ${e.target}`;
    case 'GraphReadError':
      return `graph read error at ${e.path}: ${e.message}`;
    case 'GraphWriteError':
      return `graph write error at ${e.path}: ${e.message}`;
    case 'GraphParseError':
      return `graph parse error at ${e.path}: ${e.message}`;
    case 'DimensionMismatch':
      return `vector dimension mismatch: expected ${e.expected}, got ${e.got}`;
    case 'VectorOpenError':
      return `vector store open error at ${e.path}: ${e.message}`;
    case 'VectorWriteError':
      return `vector write error for ${e.node_id}: ${e.message}`;
    case 'VectorReadError':
      return `vector read error: ${e.message}`;
    case 'ModelLoadError':
      return `embedding model load failed (${e.model}): ${e.message}`;
    case 'InferenceError':
      return `embedding inference failed: ${e.message}`;
  }
};
