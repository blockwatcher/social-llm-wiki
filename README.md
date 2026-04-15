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
  identity/      — DIDs + UCAN
  sync/          — Yjs + libp2p GossipSub
  llm-layer/     — LLM curation (ingest/maintain)
  bot/           — A2A bot coordination
  graph/         — Knowledge graph analysis, gap detection
  mcp-server/    — MCP server (6 tools) for Claude Code & Cowork
  edit-server/   — In-browser Markdown editor for Quartz
poc/
  yjs-libp2p/    — PoC: CRDT sync over GossipSub ✓
hooks/           — Claude Code session hooks (context injection)
docs/
  konzept.md           — Architecture overview (German)
  memory-architecture.md — Short/long-term memory, auto-ingest channels
  wiki-structure.md    — Folder structure, page types, graph workflow
```

## Packages

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

### `packages/graph` — Knowledge Graph

Parses `[[wikilinks]]` to build a graph, then finds:
- **Clusters** — groups of connected pages
- **Gaps** — unconnected clusters → research question prompts
- **Orphans** — pages with no links in or out
- **Bridges** — pages that connect multiple clusters
- **Dangling links** — referenced pages that don't exist yet

Inspired by the [InfraNodus](https://infranodus.com) approach to knowledge graph gap analysis.

### `packages/edit-server` — Edit Server

A lightweight in-browser Markdown editor that runs alongside Quartz.
Adds an "✎ Edit this page" button to every wiki page — split-view editor with live preview, saves directly to disk.

### `hooks/` — Claude Code Hooks

Wires the wiki into Claude Code's session lifecycle:
- **SessionStart** — loads recent wiki pages as context
- **Stop** — saves a session entry to `inbox/` (short-term memory)
- **PostToolUse** — queues a maintenance trigger when Claude edits wiki files

## Memory Architecture

```
inbox/     Short-term memory  — auto-ingested, TTL 30d, never synced
review/    Staging            — LLM proposals, user-supervised
wiki/      Long-term memory   — curated, linked, P2P-synced
```

Auto-ingest channels feed `inbox/` (email, Matrix, GPS tracks, RSS, ...).
Kai reviews periodically and proposes promotions — you decide what stays.

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

## Run the PoC

```bash
npm install
node poc/yjs-libp2p/src/demo.js
```

Demonstrates two nodes synchronizing Yjs documents over libp2p GossipSub — including concurrent edits with automatic CRDT resolution.

## Run the MCP Server

```bash
WIKI_ROOT=/path/to/wiki node packages/mcp-server/src/index.js
```

Add to `~/.claude/settings.json` (Claude Code) or `claude_desktop_config.json` (Cowork) — see [`packages/mcp-server/README.md`](packages/mcp-server/README.md).

## Run the Edit Server (alongside Quartz)

```bash
WIKI_ROOT=/path/to/quartz QUARTZ_URL=http://localhost:8080 \
  node packages/edit-server/src/index.js
```

See [`packages/edit-server/README.md`](packages/edit-server/README.md) for Quartz component installation.

## Status

- [x] Project structure + monorepo
- [x] PoC: Yjs + libp2p GossipSub sync
- [x] MCP server (6 tools)
- [x] Knowledge graph + gap analysis
- [x] Claude Code session hooks
- [x] Edit server for Quartz
- [ ] DID schema (Kai, Horst Duda)
- [ ] UCAN authorization model
- [ ] Auto-ingest channels (email, GPS, Matrix)
- [ ] A2A bot coordination
- [ ] LLM review step (inbox → wiki promotion)
