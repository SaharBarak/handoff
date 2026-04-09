/**
 * GraphRepository — port + JSON file adapter for persisting a Graph.
 *
 * The port is an interface the application layer depends on. The
 * adapter `fileGraphRepository` is the concrete implementation that
 * reads and writes `graph.json` in the NetworkX node-link format
 * graphify understands.
 *
 * Writes are atomic: we write to `<path>.tmp` and rename into place,
 * so a crashed process never leaves a half-written graph.
 *
 * Errors flow through neverthrow's ResultAsync so the application
 * layer can compose I/O and domain failures in a single chain.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { GraphError } from '../domain/errors.js';
import { empty, fromJson, toJson, type Graph } from '../domain/graph.js';

/** Port — anything that knows how to load and save a Graph. */
export interface GraphRepository {
  /** Load the graph from the underlying store. Returns an empty graph if none exists. */
  load(): ResultAsync<Graph, GraphError>;
  /** Persist a graph to the underlying store. */
  save(graph: Graph): ResultAsync<void, GraphError>;
}

/**
 * File-backed implementation. Stateless — each call re-reads or
 * re-writes the file. In-memory cache layers can wrap this if
 * hot-path performance ever matters.
 */
export const fileGraphRepository = (path: string): GraphRepository => {
  const load = (): ResultAsync<Graph, GraphError> => {
    if (!existsSync(path)) return okAsync(empty());
    return ResultAsync.fromPromise(readFile(path, 'utf8'), (e) =>
      GraphError.readError(path, (e as Error).message),
    ).andThen((text) => {
      try {
        const parsed = JSON.parse(text);
        return fromJson(parsed, path);
      } catch (e) {
        return errAsync(GraphError.parseError(path, (e as Error).message));
      }
    });
  };

  const save = (graph: Graph): ResultAsync<void, GraphError> => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(toJson(graph), null, 2));
      renameSync(tmp, path);
      return okAsync(undefined);
    } catch (e) {
      return errAsync(GraphError.writeError(path, (e as Error).message));
    }
  };

  return { load, save };
};
