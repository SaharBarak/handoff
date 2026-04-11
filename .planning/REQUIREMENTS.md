# Requirements: wellinformed v1.0

**Defined:** 2026-04-12
**Core Value:** Your coding agent answers from your actual research and codebase, not its training data.

## v1.0 Requirements

### Telegram Bridge

- [ ] **TELE-01**: User can forward a URL to the Telegram bot and it auto-ingests into the best-matching room
- [ ] **TELE-02**: Bot classifies incoming links to the correct room using keyword similarity
- [ ] **TELE-03**: Bot follows references up to configurable depth (max_depth in config)
- [ ] **TELE-04**: Daemon sends daily digest to Telegram after each tick (one message per room, top-N items)
- [ ] **TELE-05**: User can query from phone: ask, report, trigger, status, rooms
- [ ] **TELE-06**: Bot authenticates via token from config.yaml (telegram.bot_token + chat_id)

### Distribution

- [ ] **DIST-01**: Package published to npm so users can `npx wellinformed init`
- [ ] **DIST-02**: `bin` entry in package.json works globally after `npm i -g wellinformed`
- [ ] **DIST-03**: GitHub Actions CI runs tests on every push to main and PRs
- [ ] **DIST-04**: GitHub Actions auto-publishes to npm on version tag (v*)
- [ ] **DIST-05**: Dockerfile builds a working image with all deps (Node + Python + graphify)
- [ ] **DIST-06**: `docker run wellinformed daemon start` works out of the box
- [ ] **DIST-07**: README install section shows npm/npx path as primary, clone as secondary

### Source Adapters

- [ ] **ADPT-01**: Reddit adapter fetches posts from target subreddits (JSON API, no auth)
- [ ] **ADPT-02**: Dev.to adapter fetches articles matching tags (REST API)
- [ ] **ADPT-03**: Product Hunt adapter fetches trending dev tools (GraphQL API)
- [ ] **ADPT-04**: Ecosyste.ms Timeline adapter tracks package releases across registries
- [ ] **ADPT-05**: GitHub Releases adapter tracks release notes from watched repos
- [ ] **ADPT-06**: npm trending adapter tracks rising packages in the ecosystem
- [ ] **ADPT-07**: Twitter/X search adapter ingests tweets matching keywords (API v2, requires key)
- [ ] **ADPT-08**: YouTube transcript adapter extracts transcripts from tech talks/conference videos
- [ ] **ADPT-09**: Podcast RSS adapter extracts show notes + episode descriptions
- [ ] **ADPT-10**: All new adapters registered in discovery loop's KNOWN_CHANNELS

### Visualization & Export

- [ ] **VIZ-01**: `wellinformed viz` generates interactive HTML graph via graphify's Python sidecar
- [ ] **VIZ-02**: Graph visualization uses Leiden community detection for clustering
- [ ] **VIZ-03**: HTML graph is room-colored with clickable nodes linking to source_uri
- [ ] **VIZ-04**: `wellinformed export obsidian` generates an Obsidian vault from the graph
- [ ] **VIZ-05**: Obsidian vault has one note per node with backlinks for edges
- [ ] **VIZ-06**: Multi-room tunnel detection demonstrated with at least 2 real rooms

## v2 Requirements

### Advanced Intelligence

- **INTEL-01**: Automatic room classification for untagged content using embedding similarity
- **INTEL-02**: Trend detection across time — surface topics growing in frequency
- **INTEL-03**: Citation graph — track which papers/posts reference each other

### Platform Expansion

- **PLAT-01**: Cursor integration guide + tested setup
- **PLAT-02**: Copilot integration guide
- **PLAT-03**: Gemini CLI integration guide

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web dashboard | Terminal-native, MCP is the interface |
| Mobile app | Telegram bridge covers mobile use |
| Custom embedding models | all-MiniLM-L6-v2 is sufficient, adding model selection adds complexity |
| Real-time streaming | Batch ingest is the model, not live feeds |
| Multi-user auth | Single-user tool, per-machine state |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TELE-01 | Phase 7 | Pending |
| TELE-02 | Phase 7 | Pending |
| TELE-03 | Phase 7 | Pending |
| TELE-04 | Phase 7 | Pending |
| TELE-05 | Phase 7 | Pending |
| TELE-06 | Phase 7 | Pending |
| ADPT-01 | Phase 8 | Pending |
| ADPT-02 | Phase 8 | Pending |
| ADPT-03 | Phase 8 | Pending |
| ADPT-04 | Phase 8 | Pending |
| ADPT-05 | Phase 8 | Pending |
| ADPT-06 | Phase 8 | Pending |
| ADPT-07 | Phase 8 | Pending |
| ADPT-08 | Phase 8 | Pending |
| ADPT-09 | Phase 8 | Pending |
| ADPT-10 | Phase 8 | Pending |
| VIZ-01 | Phase 9 | Pending |
| VIZ-02 | Phase 9 | Pending |
| VIZ-03 | Phase 9 | Pending |
| VIZ-04 | Phase 9 | Pending |
| VIZ-05 | Phase 9 | Pending |
| VIZ-06 | Phase 9 | Pending |
| DIST-01 | Phase 10 | Pending |
| DIST-02 | Phase 10 | Pending |
| DIST-03 | Phase 10 | Pending |
| DIST-04 | Phase 10 | Pending |
| DIST-05 | Phase 10 | Pending |
| DIST-06 | Phase 10 | Pending |
| DIST-07 | Phase 10 | Pending |

**Coverage:**
- v1.0 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-12 after initial definition*
