/**
 * Phase 1 acceptance test — rooms isolation, global search, tunnel detection.
 *
 * This test drives the DDD stack from the application layer down:
 *
 *   tests → use-cases → { graphRepository, vectorIndex, fixtureEmbedder }
 *                         ↓
 *                        domain (pure Graph + vector ops)
 *
 * It uses `fixtureEmbedder` with pre-registered deterministic vectors
 * so assertions are exact and no model download is needed.
 *
 * Scenario (three nodes across two rooms):
 *
 *   homelab/mikrotik-chr    e1 = unit([1, 0, 0, ...])
 *   homelab/proxmox-nic     e2 = unit([0.98, 0.2, 0, ...])    (near-dup in same room)
 *   fundraise/safe-vpn      e3 = unit([0.85, 0,  0.5, ...])    (CROSS-room, still close)
 *
 * Expectations:
 *   (a) indexNode persists graph + vector + embedding_id atomically
 *   (b) searchByRoom('homelab', e1-text) returns only homelab nodes
 *   (c) searchGlobal returns all three, monotone non-decreasing distance
 *   (d) findTunnels(threshold=0.6) surfaces (mikrotik-chr, safe-vpn)
 *   (e) exploreRoom stays inside the room when traversing
 *   (f) graph persistence round-trips room/wing/source_uri/fetched_at/embedding_id
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_DIM, sparse } from '../src/domain/vectors.js';
import { getNode, nodesInRoom, upsertEdge } from '../src/domain/graph.js';
import type { GraphNode } from '../src/domain/graph.js';
import { fileGraphRepository } from '../src/infrastructure/graph-repository.js';
import { openSqliteVectorIndex } from '../src/infrastructure/vector-index.js';
import { fixtureEmbedder } from '../src/infrastructure/embedders.js';
import {
  exploreRoom,
  findTunnels,
  indexNode,
  searchByRoom,
  searchGlobal,
  type UseCaseDeps,
} from '../src/application/use-cases.js';

const NOW = '2026-04-09T14:30:00Z';

const node = (
  id: string,
  label: string,
  room: string,
  wing: string,
  source_uri: string,
): GraphNode => ({
  id,
  label,
  file_type: 'document',
  source_file: source_uri,
  room,
  wing,
  source_uri,
  fetched_at: NOW,
});

const unwrap = <T, E>(label: string, r: { isOk(): boolean; value?: T; error?: E }): T => {
  if (!r.isOk()) {
    throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  }
  return r.value as T;
};

test('phase 1 — rooms isolation, semantic search, tunnel detection (DDD stack)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wellinformed-phase1-'));
  try {
    // ── arrange ──

    const graphPath = join(tmp, 'graph.json');
    const vectorPath = join(tmp, 'vectors.db');

    const graphs = fileGraphRepository(graphPath);
    const vectorsResult = await openSqliteVectorIndex({ path: vectorPath });
    const vectors = unwrap('openSqliteVectorIndex', vectorsResult);

    // fixture embedder: pin deterministic vectors to the exact input strings
    // so the test is hermetic and fast. dim defaults to 384.
    const embedder = fixtureEmbedder();
    const t1 = 'Mikrotik CHR licensing'; // homelab/mikrotik-chr
    const t2 = 'Proxmox passthrough NIC'; // homelab/proxmox-nic
    const t3 = 'Safe Global VPN stack'; // fundraise/safe-vpn

    embedder.register(t1, sparse([[0, 1], [1, 0], [2, 0]]));
    embedder.register(t2, sparse([[0, 0.98], [1, 0.2], [2, 0]]));
    embedder.register(t3, sparse([[0, 0.85], [1, 0], [2, 0.5]]));

    const deps: UseCaseDeps = { graphs, vectors, embedder };

    // ── act ──

    // 1. indexNode — atomic (embed, upsert vector, upsert graph node)
    const n1 = node(
      'homelab/mikrotik-chr',
      t1,
      'homelab',
      'network',
      'https://help.mikrotik.com/docs/display/ROS/CHR',
    );
    const n2 = node(
      'homelab/proxmox-nic',
      t2,
      'homelab',
      'virtualization',
      'https://pve.proxmox.com/wiki/PCI(e)_Passthrough',
    );
    const n3 = node(
      'fundraise/safe-vpn',
      t3,
      'fundraise',
      'infra',
      'https://safe.global/docs/security',
    );

    const index = indexNode(deps);
    for (const [n, text] of [[n1, t1], [n2, t2], [n3, t3]] as const) {
      const r = await index({ node: n, text, room: n.room!, wing: n.wing });
      unwrap(`indexNode(${n.id})`, r);
    }

    // 2. add an intra-room edge so BFS has something to traverse
    const loaded = unwrap('graphs.load', await graphs.load());
    const withEdge = unwrap(
      'upsertEdge',
      upsertEdge(loaded, {
        source: 'homelab/mikrotik-chr',
        target: 'homelab/proxmox-nic',
        relation: 'co_configured_with',
        confidence: 'EXTRACTED',
        source_file: 'seed',
      }),
    );
    unwrap('graphs.save', await graphs.save(withEdge));

    // ── assert ──

    // (a) persistence round-trip — re-open the graph from disk
    const reloaded = unwrap('reloaded', await graphs.load());
    assert.equal(reloaded.json.nodes.length, 3);
    assert.equal(reloaded.json.links.length, 1);
    const mik = getNode(reloaded, 'homelab/mikrotik-chr');
    assert.ok(mik, 'mikrotik-chr persisted');
    assert.equal(mik!.room, 'homelab');
    assert.equal(mik!.wing, 'network');
    assert.equal(mik!.source_uri, n1.source_uri);
    assert.equal(mik!.fetched_at, NOW);
    assert.equal(mik!.embedding_id, 'homelab/mikrotik-chr', 'indexNode must set embedding_id');

    // (b) room isolation via use case
    const byRoom = unwrap(
      'searchByRoom',
      await searchByRoom(deps)({ room: 'homelab', text: t1, k: 5 }),
    );
    const byRoomIds = byRoom.map((m) => m.node_id);
    assert.ok(byRoomIds.includes('homelab/mikrotik-chr'));
    assert.ok(byRoomIds.includes('homelab/proxmox-nic'));
    assert.ok(!byRoomIds.includes('fundraise/safe-vpn'));
    assert.equal(byRoom[0].node_id, 'homelab/mikrotik-chr', 'top hit is self');

    // (c) global search returns all three in distance order
    const global = unwrap(
      'searchGlobal',
      await searchGlobal(deps)({ text: t1, k: 10 }),
    );
    assert.equal(global.length, 3);
    assert.equal(global[0].node_id, 'homelab/mikrotik-chr');
    assert.ok(global.map((m) => m.node_id).includes('fundraise/safe-vpn'));
    for (let i = 1; i < global.length; i++) {
      assert.ok(
        global[i].distance >= global[i - 1].distance,
        `distances must be monotone non-decreasing`,
      );
    }

    // (d) tunnel detection surfaces the cross-room pair
    const tunnels = unwrap('findTunnels', await findTunnels(deps)({ threshold: 0.6 }));
    assert.ok(tunnels.length >= 1, `expected at least one tunnel candidate, got ${tunnels.length}`);
    const top = tunnels[0];
    assert.notEqual(top.room_a, top.room_b, 'endpoints must be in different rooms');
    const pair = [top.a, top.b].sort().join('|');
    assert.equal(pair, ['fundraise/safe-vpn', 'homelab/mikrotik-chr'].sort().join('|'));

    // (e) exploreRoom room-filtered BFS — never leaves homelab
    const explored = unwrap(
      'exploreRoom',
      await exploreRoom(deps)({ room: 'homelab', text: t1, depth: 3, k: 2 }),
    );
    const exploredIds = explored.nodes.map((n) => n.id).sort();
    assert.deepEqual(exploredIds, ['homelab/mikrotik-chr', 'homelab/proxmox-nic']);
    assert.ok(
      !exploredIds.includes('fundraise/safe-vpn'),
      'exploreRoom must not cross rooms',
    );

    // (f) nodesInRoom (pure domain helper)
    assert.equal(nodesInRoom(reloaded, 'homelab').length, 2);
    assert.equal(nodesInRoom(reloaded, 'fundraise').length, 1);

    vectors.close();

    // smoke: DEFAULT_DIM constant is what the test expects
    assert.equal(DEFAULT_DIM, 384);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
