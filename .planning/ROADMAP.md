# Roadmap: wellinformed v1.1

**Milestone:** v1.1 Close Competitive Gaps
**Phases:** 11-14 (continues from v1.0 which ended at Phase 10)
**Requirements:** 20 mapped

## Phase 11: Session Management + Biomimetic Memory

**Goal:** Session captures consolidate automatically, old sessions decay, retrieval prioritizes recent + relevant content. Closes the claude-mem Endless Mode gap.

**Requirements:** SESS-01..05

**Success criteria:**
1. After 50+ session captures, consolidation runs automatically and produces summary nodes
2. Old individual session nodes are removed, graph node count stabilizes
3. Search results rank recent sessions higher than month-old ones
4. `wellinformed report` shows session consolidation stats

## Phase 12: Multimodal Ingestion

**Goal:** wellinformed can ingest images (metadata + OCR), audio (transcription), and PDFs (text extraction). Closes the Cognee multimodal gap.

**Requirements:** MULTI-01..05

**Success criteria:**
1. `wellinformed sources add` accepts image/audio/PDF source kinds
2. Image files produce nodes with extracted alt-text, EXIF data, or OCR text
3. Audio files produce nodes with transcribed text
4. PDF files produce nodes with extracted text, chunked and embedded
5. All multimodal content flows through the standard chunk → embed → index pipeline

## Phase 13: Web Dashboard

**Goal:** A browser-based read-only dashboard showing the live knowledge graph with search, room filter, and node inspector. Closes the mcp-memory-service web dashboard gap.

**Requirements:** DASH-01..06

**Success criteria:**
1. `wellinformed dashboard` opens a browser to localhost:3737
2. Graph renders with vis.js, nodes colored by room, edges visible
3. Search box finds nodes semantically, highlights matches
4. Room sidebar shows counts, click to filter
5. Click a node → inspector shows all attributes + neighbors
6. Graph refreshes automatically on interval

## Phase 14: Real ONNX IR Benchmarks

**Goal:** Run the labeled corpus through real all-MiniLM-L6-v2 embeddings and publish honest P@K, R@K, MRR, NDCG numbers. Proves wellinformed's semantic quality.

**Requirements:** BENCH-01..04

**Success criteria:**
1. Benchmark test downloads and uses real Xenova all-MiniLM-L6-v2 (not fixture embedder)
2. IR metrics (P@5, R@5, MRR, NDCG@5) reported with actual semantic similarity
3. Latency includes ONNX inference time, not just sqlite-vec
4. docs/BENCHMARKS.md published with methodology + reproducibility

## Phase Summary

| Phase | Name | Requirements | Success Criteria |
|-------|------|-------------|------------------|
| 11 | Session Management | SESS-01..05 (5) | 4 |
| 12 | Multimodal Ingestion | MULTI-01..05 (5) | 5 |
| 13 | Web Dashboard | DASH-01..06 (6) | 6 |
| 14 | Real ONNX Benchmarks | BENCH-01..04 (4) | 4 |
| **Total** | | **20** | **19** |

---
*Roadmap created: 2026-04-12*
