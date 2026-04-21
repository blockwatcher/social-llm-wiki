# Social LLM Wiki

A decentralized, P2P wiki that serves as a shared memory for humans, groups, and LLM agents alike.
Humans and bots collaboratively curate a living knowledge base — no central server, no single owner.
Personal memory for your agent, collective memory for your group, social memory for everyone.

## Vision

- No central server — P2P via libp2p
- Bots (Kai, Horst Duda) as LLM curators
- Multi-human + multi-bot collaboration
- Decentralized access control (UCAN)
- Conflict-free editing via CRDTs (Yjs)
- Bot coordination via A2A protocol
- Knowledge graph analysis with gap detection (InfraNodus approach)

## Architecture

```
packages/
  sync/          — Yjs + libp2p GossipSub P2P sync (production-ready ✓)
  llm-layer/     — LLM curation: ingest, review loop (implemented ✓)
  channels/      — Auto-ingest channels: file-watch (implemented ✓)
  identity/      — DIDs + UCAN (planned)
  bot/           — A2A bot coordination (planned)
  graph/         — Knowledge graph analysis, gap detection
  mcp-server/    — MCP server (6 tools) for Claude Code & Cowork
  edit-server/   — In-browser Markdown editor for Quartz
poc/
  yjs-libp2p/    — PoC: CRDT sync over GossipSub ✓
hooks/           — Claude Code session hooks (context injection)
docs/
  konzept.md             — Architecture concept
  memory-architecture.md — Memory layer model (raw/inbox/review/wiki)
  sync-architecture.md   — P2P sync deep-dive
  wiki-structure.md      — Folder structure, page types, graph workflow
```

---

## Packages

### `packages/sync` — P2P Sync Layer ✓

Conflict-free, real-time wiki synchronization over a P2P network.
**Production-ready and tested** between Raspberry Pi 5 and a Hetzner cloud server.

**Stack:** Yjs CRDTs + libp2p (TCP / Yamux / Noise) + GossipSub + Circuit Relay v2

Two sync mechanisms work together:
- **GossipSub** — broadcasts incremental Yjs deltas to all connected peers in real time
- **`/wiki-sync/1.0.0`** — custom protocol that exchanges full Yjs state when a peer connects,
  so joining peers immediately receive all history (not just future updates)

Additional features:
- **File-bridge** — bidirectional sync between the Yjs document and `.md` files on disk;
  any tool that edits files (edit server, LLM agents, manual edits) is automatically reflected in Yjs
- **State persistence** — Yjs state is saved as a binary snapshot after every write (debounced 2s);
  restarts are seamless, peers exchange only what's missing
- **Circuit Relay v2** — nodes behind NAT can be reached via a public relay server

```js
import { createWikiNode } from '@social-llm-wiki/sync'

const { node, doc, pages, multiaddr, stop } = await createWikiNode({
  wikiRoot: '/path/to/wiki',
  namespace: '@darius',
  port: 0,                    // TCP port (0 = random)
  peers: ['<multiaddr>'],     // peers to dial on startup
  relay: '<relay-multiaddr>', // optional: circuit relay for NAT traversal
})
```

See [`docs/sync-architecture.md`](docs/sync-architecture.md) for the full technical deep-dive.

---

### `packages/llm-layer` — LLM Curation ✓

Implements the Karpathy ingest/maintain pattern: raw input → structured inbox entry → wiki page.

**`ingest(raw, options)`** — Normalizes raw text through Claude:
- Saves the original to `raw/text/` (permanent, never lost)
- Calls Claude with a cached system prompt (Kai persona)
- Extracts title, tags, summary, and key concepts
- Writes a structured Markdown entry with frontmatter to `inbox/`

**`runReview(options)`** — Periodically reviews `inbox/` and proposes promotions:
- Reads all unprocessed inbox entries in a single batched Claude call
- Claude returns a JSON decision: `promote | skip` for each entry
- Promoted entries are drafted into `review/candidates/` for user approval
- Original inbox entries are marked `promoted: true`

Uses the Anthropic SDK with `cache_control: ephemeral` on the system prompt to keep
repeated review calls fast and cost-efficient.

---

### `packages/channels` — Auto-Ingest Channels ✓

Channels feed external sources into the LLM ingest pipeline.

**`file-watch`** — Watches a drop folder for new `.txt` / `.md` files:
- On startup: processes any files already in the drop folder
- At runtime: picks up new files within 200ms of creation
- Calls `ingest()` on each file, then moves it to `drop/.done/`
- Designed to be run as a persistent systemd service

More channels planned: email-imap, Matrix, RSS, GPS tracks, voice memos.

---

### `packages/mcp-server` — MCP Server

Exposes the wiki as tools for Claude Code, Claude Desktop (Cowork), and any MCP-compatible client.

| Tool | Description |
|---|---|
| `wiki_list` | List pages in a namespace |
| `wiki_read` | Read a single wiki page |
| `wiki_search` | Full-text search across pages |
| `wiki_write_inbox` | Save a note to short-term memory |
| `wiki_graph` | Analyze the knowledge graph (clusters, orphans, bridges) |
| `wiki_gaps` | Find knowledge gaps + generate research prompts |

---

### `packages/graph` — Knowledge Graph

Parses `[[wikilinks]]` to build a graph, then finds:
- **Clusters** — groups of connected pages
- **Gaps** — unconnected clusters → research question prompts
- **Orphans** — pages with no links in or out
- **Bridges** — pages that connect multiple clusters
- **Dangling links** — referenced pages that don't exist yet

Inspired by the [InfraNodus](https://infranodus.com) approach to knowledge graph gap analysis.

---

### `packages/edit-server` — Edit Server

A lightweight in-browser Markdown editor that runs alongside Quartz.
Adds an "✎ Edit this page" button to every wiki page — split-view editor with live preview,
saves directly to disk (and automatically syncs via the file-bridge).

---

### `hooks/` — Claude Code Hooks

Wires the wiki into Claude Code's session lifecycle:
- **SessionStart** — loads recent wiki pages as context
- **Stop** — saves a session entry to `inbox/` (short-term memory)
- **PostToolUse** — queues a maintenance trigger when Claude edits wiki files

---

## Memory Architecture

The wiki models human memory with four layers:

```
raw/       Sensory buffer    — original sources, permanent, never read by LLM directly
inbox/     Short-term        — normalized, auto-ingested, 30d TTL
review/    Working memory    — LLM proposals, user-supervised
wiki/      Long-term         — curated, linked, P2P-synced, permanent
```

Only `wiki/` participates in P2P sync. `raw/`, `inbox/`, and `review/` are strictly personal.

Auto-ingest channels feed `inbox/` (email, Matrix, GPS tracks, RSS, file-drop, ...).
Kai reviews periodically and proposes promotions — you decide what stays.

See [`docs/memory-architecture.md`](docs/memory-architecture.md) for the full model.

---

## Wiki Folder Structure

```
wiki/@darius/
  concepts/   — core concepts, heavily interlinked
  sources/    — source summaries with backlinks
  data/       — structured evidence and references
  output/     — insights generated from gap analysis
  gaps/       — gap analysis reports (auto-generated)
  reisen/     — travel pages
  notizen/    — free notes
  projekte/   — project pages
```

---

## Getting Started

### Requirements

- Node ≥ 22
- ESM throughout (`"type": "module"`)

### Install

```bash
npm install
```

### Run the PoC

```bash
node poc/yjs-libp2p/src/demo.js
```

Demonstrates two in-process nodes synchronizing Yjs documents over libp2p GossipSub,
including concurrent edits with automatic CRDT resolution.

### Run a Sync Node

```bash
WIKI_ROOT=/path/to/wiki node -e "
  import('./packages/sync/src/index.js').then(({ createWikiNode }) =>
    createWikiNode({ wikiRoot: process.env.WIKI_ROOT, namespace: '@darius' })
  )
"
```

### Run the File-Watch Channel

```bash
# Copy .env.example to .env and fill in ANTHROPIC_API_KEY + WIKI_ROOT
cp .env.example .env
npm run watch
```

### Run the LLM Review Loop

```bash
npm run review
```

### Run the MCP Server

```bash
WIKI_ROOT=/path/to/wiki node packages/mcp-server/src/index.js
```

Add to `~/.claude/settings.json` (Claude Code) or `claude_desktop_config.json` (Cowork) —
see [`packages/mcp-server/README.md`](packages/mcp-server/README.md).

### Run the Edit Server (alongside Quartz)

```bash
WIKI_ROOT=/path/to/quartz QUARTZ_URL=http://localhost:8080 \
  node packages/edit-server/src/index.js
```

See [`packages/edit-server/README.md`](packages/edit-server/README.md) for Quartz component installation.

### Systemd Services

For always-on deployment on a Raspberry Pi or server:

```bash
# File-watch channel (persistent)
sudo systemctl enable --now wiki-file-watch.service

# LLM review loop (daily at 07:00)
sudo systemctl enable --now wiki-review.timer
```

Service files are in the repo root (`wiki-file-watch.service`, `wiki-review.service`, `wiki-review.timer`).

---

## Status

### Implemented ✓

- [x] Monorepo structure + ESM throughout
- [x] PoC: Yjs + libp2p GossipSub sync (2-node in-process)
- [x] `packages/sync` — production P2P sync layer
  - [x] GossipSub live broadcast
  - [x] `/wiki-sync/1.0.0` full-state exchange on peer connect
  - [x] Bidirectional file-bridge (Yjs ↔ filesystem)
  - [x] Binary state persistence with debounced saves
  - [x] Circuit Relay v2 transport (NAT traversal)
  - [x] **Real-world test: RPi 5 ↔ Hetzner server, bidirectional sync confirmed**
- [x] `packages/llm-layer` — LLM ingest + review loop
  - [x] `ingest()` — raw → inbox via Claude (prompt caching)
  - [x] `runReview()` — inbox → review/candidates (batched LLM call)
- [x] `packages/channels` — file-watch channel
- [x] `packages/mcp-server` — MCP server (6 tools)
- [x] `packages/graph` — knowledge graph + gap analysis
- [x] `packages/edit-server` — in-browser Markdown editor
- [x] `hooks/` — Claude Code session lifecycle hooks
- [x] Systemd services + timers

### Planned

- [ ] `packages/identity` — DID schema (Kai, Horst Duda) + UCAN authorization
- [ ] `packages/bot` — A2A bot coordination protocol
- [ ] Auto-ingest channels: email-imap, Matrix, RSS, GPS tracks, voice memos
- [ ] LLM review notifications (Matrix)
- [ ] Shared namespaces (`groups/`) with multi-user sync
- [ ] Meilisearch full-text search integration

---

## Hardware

Primary: Raspberry Pi 5 (8 GB)
Planned: Mac Mini M5 (2026 H2)

The sync layer runs comfortably on RPi 5 — Yjs state is compact, libp2p is lightweight.
