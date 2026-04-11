# Requirements: wellinformed v1.1

**Defined:** 2026-04-12
**Core Value:** Your coding agent answers from your actual research and codebase, not its training data.

## v1.1 Requirements

### Session Management

- [ ] **SESS-01**: Session captures are automatically consolidated after exceeding a configurable threshold (default 50 entries)
- [ ] **SESS-02**: Consolidated sessions produce a summary node that preserves the key decisions and topics discussed
- [ ] **SESS-03**: Old individual session nodes are replaced by the summary (graph doesn't grow unboundedly)
- [ ] **SESS-04**: Session memory has decay scoring — recent sessions rank higher in search results
- [ ] **SESS-05**: Retrieval priority scoring weights recency, frequency of topic, and semantic relevance

### Multimodal Ingestion

- [ ] **MULTI-01**: Image adapter extracts alt-text, EXIF metadata, and filename analysis from image files
- [ ] **MULTI-02**: Image OCR adapter runs tesseract on screenshots/diagrams to extract text content
- [ ] **MULTI-03**: Audio transcription adapter extracts text from audio files via whisper or equivalent
- [ ] **MULTI-04**: PDF adapter extracts full text from PDF documents (ArXiv full papers, whitepapers)
- [ ] **MULTI-05**: All multimodal adapters produce standard ContentItem values that flow through the existing chunk + embed pipeline

### Web Dashboard

- [ ] **DASH-01**: `wellinformed dashboard` starts an HTTP server on localhost serving a browser-based graph visualization
- [ ] **DASH-02**: Dashboard renders the knowledge graph with vis.js, room-colored nodes, clickable to source_uri
- [ ] **DASH-03**: Dashboard includes a search box that calls the search MCP tool and highlights matching nodes
- [ ] **DASH-04**: Dashboard shows room filter sidebar with node counts per room
- [ ] **DASH-05**: Dashboard shows node inspector panel (click a node → see all attributes, neighbors, edges)
- [ ] **DASH-06**: Dashboard auto-refreshes graph state on a configurable interval

### Real ONNX Benchmarks

- [ ] **BENCH-01**: Benchmark test uses real Xenova all-MiniLM-L6-v2 model (not fixture embedder) on the labeled corpus
- [ ] **BENCH-02**: Reports real P@5, R@5, MRR, NDCG@5 with actual semantic embeddings
- [ ] **BENCH-03**: Latency percentiles measured with real ONNX inference included (not just sqlite-vec lookup)
- [ ] **BENCH-04**: Results documented in docs/BENCHMARKS.md with methodology, corpus description, and reproducibility instructions

## v2 Requirements

### Advanced Intelligence

- **INTEL-01**: Trend detection across time — surface topics growing in frequency
- **INTEL-02**: Citation graph — track which papers/posts reference each other
- **INTEL-03**: Auto-tagging — classify nodes by topic using embedding clusters

## Out of Scope

| Feature | Reason |
|---------|--------|
| Video ingestion | Requires video processing infrastructure — defer to v2 |
| Real-time streaming ingest | Batch model sufficient for research use case |
| Multi-user collaboration | Single-user tool, per-machine state |
| Cloud sync | Local-first — Cloudflare backend is a v2 consideration |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SESS-01 | Phase 11 | Pending |
| SESS-02 | Phase 11 | Pending |
| SESS-03 | Phase 11 | Pending |
| SESS-04 | Phase 11 | Pending |
| SESS-05 | Phase 11 | Pending |
| MULTI-01 | Phase 12 | Pending |
| MULTI-02 | Phase 12 | Pending |
| MULTI-03 | Phase 12 | Pending |
| MULTI-04 | Phase 12 | Pending |
| MULTI-05 | Phase 12 | Pending |
| DASH-01 | Phase 13 | Pending |
| DASH-02 | Phase 13 | Pending |
| DASH-03 | Phase 13 | Pending |
| DASH-04 | Phase 13 | Pending |
| DASH-05 | Phase 13 | Pending |
| DASH-06 | Phase 13 | Pending |
| BENCH-01 | Phase 14 | Pending |
| BENCH-02 | Phase 14 | Pending |
| BENCH-03 | Phase 14 | Pending |
| BENCH-04 | Phase 14 | Pending |

**Coverage:**
- v1.1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-12 after initial definition*
