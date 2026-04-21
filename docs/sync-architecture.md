# Sync Architecture

How the Social LLM Wiki synchronizes wiki pages across nodes without a central server.

---

## Overview

The sync layer (`packages/sync`) provides conflict-free, P2P synchronization of wiki pages
using two complementary mechanisms:

1. **GossipSub** — live broadcast of incremental CRDT updates to all connected peers
2. **`/wiki-sync/1.0.0`** — custom libp2p protocol for full-state exchange when a peer connects

Together they ensure that both live edits and historical state reach every peer, regardless
of when they joined the network.

---

## Stack

| Component | Technology | Role |
|---|---|---|
| CRDT | [Yjs](https://github.com/yjs/yjs) | Conflict-free document model |
| Transport | libp2p TCP + Yamux + Noise | Encrypted, multiplexed connections |
| Pubsub | GossipSub (ChainSafe) | Live update broadcast |
| NAT traversal | Circuit Relay v2 | Nodes behind NAT reachable via relay |
| State persistence | Binary Yjs snapshots | Survives process restarts |
| File sync | Bidirectional file-bridge | Yjs ↔ filesystem |

---

## Data Model

Each wiki namespace is a `Y.Doc` containing a single `Y.Map<string, Y.Text>` called `pages`.

```
Y.Doc
  └── pages: Y.Map
        ├── "concepts/libp2p.md"  → Y.Text  (Markdown content)
        ├── "notizen/meeting.md"  → Y.Text
        └── ...
```

Key properties of this model:
- **Concurrent edits are automatically merged** — Yjs handles conflicts at the character level
- **Deletes are tombstoned** — no content is silently lost on concurrent delete+edit
- **State is portable** — any node can serialize its full state as a binary blob and send it to any other node

---

## Sync Mechanisms

### 1. GossipSub — Live Updates

Every local change to a `Y.Text` produces a Yjs update (a compact binary delta).
The node immediately publishes this delta to the GossipSub topic for its namespace:

```
topic: social-llm-wiki/v1/@darius
```

All subscribed peers receive and apply the delta. Origin tracking (`'remote'`) prevents
re-broadcasting received updates.

**Limitation:** GossipSub is a fire-and-forget broadcast. A peer that was offline during
an edit will never receive that delta via GossipSub — this is the gap the sync protocol closes.

### 2. `/wiki-sync/1.0.0` — Full-State Exchange

When two nodes connect, each sends the other its complete Yjs state:

```
peer:connect
  → dialProtocol('/wiki-sync/1.0.0')
  → send Y.encodeStateAsUpdate(doc)      ← full state as binary
  ← receive full state from peer
  → Y.applyUpdate(doc, state, 'peer-sync')
```

Yjs merges are **idempotent** — applying the same update twice has no effect. So sending full
state is always safe, even if the peer already has most of it.

A 300ms delay after `peer:connect` lets the connection settle and ensures the peer's protocol
handler is registered before the dial.

---

## File-Bridge

The file-bridge (`packages/sync/src/file-bridge.js`) keeps the Yjs document and the filesystem
in sync, so that:
- Any tool that writes Markdown files (edit server, manual edits, LLM agents) is automatically
  reflected in Yjs and broadcast to peers
- Any remote update received via sync is immediately written to disk for Quartz to serve

```
Filesystem (.md files)
    │  fs.watch → debounced read
    │                            ↑ skip if content == Yjs (avoid loop)
    ▼
Y.Text  ─── update event ──────► GossipSub publish
    │                            (origin !== 'local-file')
    └── observe (origin check) → writeFile
```

Circular update prevention:
- Writes from Yjs to disk use `'local-file'` as the transaction origin
- The `fs.watch` handler compares file content to the current Yjs value and skips if equal
- Result: one file change → one Yjs update → one peer broadcast, no loops

---

## State Persistence

Yjs state is saved to disk as a binary snapshot after each batch of updates (debounced 2s):

```
wiki/.yjs/
  _darius_.bin     ← binary Yjs state for @darius namespace
```

On startup, the snapshot is loaded before connecting to peers. This means:
- The node is immediately up-to-date from disk even before the first peer connection
- The full-state exchange with peers brings in any updates made while offline
- History is never lost — restarts are seamless

---

## Node Lifecycle

```
createWikiNode(opts)
  1. Load persisted Yjs state (if any)
  2. Create libp2p node (TCP, Yamux, Noise, GossipSub, Identify)
  3. Register GossipSub update handlers
  4. Register /wiki-sync/1.0.0 inbound handler
  5. Register peer:connect → full-state push
  6. Start file-bridge (load existing files, watch for changes)
  7. node.start() + subscribe to GossipSub topic
  8. Dial relay (if provided) — for NAT traversal
  9. Dial initial peers
```

---

## NAT Traversal

Nodes behind a home router (RPi, laptop) cannot accept inbound connections by default.
The sync layer supports Circuit Relay v2 for NAT traversal:

- A public relay node (running `@libp2p/circuit-relay-v2` server) accepts reservations
- The NAT-ed node dials the relay and requests a reservation
- Other peers can then dial through the relay to reach the NAT-ed node
- The relay only relays the initial connection; after that, the two peers communicate directly if possible

```js
const node = await createWikiNode({
  wikiRoot: '/path/to/wiki',
  namespace: '@darius',
  relay: '/ip4/<relay-ip>/tcp/<relay-port>/p2p/<relay-peer-id>',
  peers: ['...'],
})
```

The relay address is never hardcoded in the codebase — it is passed at runtime via config or environment.

---

## Configuration

```js
import { createWikiNode } from '@social-llm-wiki/sync'

const { node, doc, pages, multiaddr, stop } = await createWikiNode({
  wikiRoot: '/home/user/wiki',   // root of the wiki directory tree
  namespace: '@darius',          // which namespace to sync
  port: 0,                       // TCP listen port (0 = random)
  peers: [],                     // multiaddrs to dial on startup
  relay: null,                   // circuit relay server multiaddr (optional)
})
```

Return value:
- `node` — the raw libp2p node (for advanced use)
- `doc` — the Yjs document
- `pages` — `Y.Map<string, Y.Text>` — the page map
- `multiaddr` — the node's announced listen address
- `stop()` — graceful shutdown (stops file-bridge + libp2p)

---

## Deployment

### Single node (local only)

```bash
WIKI_ROOT=/path/to/wiki node -e "
  import('@social-llm-wiki/sync').then(({ createWikiNode }) =>
    createWikiNode({ wikiRoot: process.env.WIKI_ROOT })
  )
"
```

### Two nodes over LAN or public internet

Node A (server with public IP, port open in firewall):
```bash
createWikiNode({ wikiRoot, port: 7911 })
# announces: /ip4/<public-ip>/tcp/7911/p2p/<peer-id>
```

Node B (client, dials A):
```bash
createWikiNode({
  wikiRoot,
  peers: ['/ip4/<server-ip>/tcp/7911/p2p/<server-peer-id>'],
})
```

### Node behind NAT (via relay)

```bash
createWikiNode({
  wikiRoot,
  relay: '/ip4/<relay-ip>/tcp/<relay-port>/p2p/<relay-peer-id>',
  peers: ['...'],
})
```

---

## Tested

Real-world P2P sync test between Raspberry Pi 5 (home network, behind NAT, Node 24)
and a Hetzner cloud server (public IP, Node 22) — April 2026:

- ✓ RPi → Hetzner: page written on RPi appeared on Hetzner within 1s
- ✓ Hetzner → RPi: page written on Hetzner (via file-bridge) appeared on RPi within 5s
- ✓ Yjs persistence: RPi restarted between writes, state correctly restored from `.yjs/` snapshot
- ✓ Bidirectional full-state exchange on connect
- ✓ No data loss, no duplicates, no loops

---

## Security Considerations (Phase 1)

- All connections are encrypted via Noise protocol
- There is currently **no authorization** — any peer that knows your multiaddr can push updates
- UCAN-based authorization is planned for Phase 2 (`packages/identity`)
- For now: keep your node's multiaddr private; use firewall rules to limit who can connect

---

## Packages

| File | Role |
|---|---|
| `src/wiki-node.js` | Main entry point — assembles all components |
| `src/file-bridge.js` | Bidirectional Yjs ↔ filesystem sync |
| `src/persist.js` | Binary state persistence (load/save/debounce) |
| `src/index.js` | Public exports |
