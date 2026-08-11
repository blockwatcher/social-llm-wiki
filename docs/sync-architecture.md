# Sync Architecture

How the Social LLM Wiki synchronizes shared pages across nodes without a central server.

This is the deep reference for `packages/sync`. For what the system is and how the
pieces fit together, see [konzept.md](konzept.md).

**Stand: 2026-08-11.**

---

## Overview

The sync layer provides conflict-free P2P synchronization using two complementary
mechanisms:

1. **GossipSub** — live broadcast of incremental CRDT updates to connected peers
2. **`/wiki-sync/1.0.0`** — custom libp2p protocol for full-state exchange on connect

Together they cover both live edits and history, regardless of when a peer joined.

What is synchronized is **one shared group**, not a whole wiki. A node syncs
`pages/social/<group>/`; the private part of the wiki never enters a Yjs document.

---

## Stack

| Component | Technology | Role |
|---|---|---|
| CRDT | [Yjs](https://github.com/yjs/yjs) | Conflict-free document model |
| Transport | libp2p 3.x — TCP + Yamux + Noise | Encrypted, multiplexed connections |
| Pubsub | `@libp2p/gossipsub` | Live update broadcast |
| NAT traversal | Circuit Relay v2 | Both peers sit behind NAT |
| Identity | Ed25519 key file | Stable PeerID across restarts |
| State persistence | Binary Yjs snapshots | Survives process restarts |
| File sync | Bidirectional file-bridge | Yjs ↔ filesystem |

`@chainsafe/libp2p-gossipsub` was replaced during the libp2p 2→3 migration; see
[libp2p-v3-migration.md](libp2p-v3-migration.md).

---

## Data Model

Each namespace is a `Y.Doc` containing a single `Y.Map<string, Y.Text>` called `pages`.
Keys are paths relative to the group directory.

```
Y.Doc
  └── pages: Y.Map
        ├── "go-rechenkern/go-rechenkern-uebersicht.md"  → Y.Text
        ├── "laermzentrale/laermzentrale-uebersicht.md"  → Y.Text
        └── ...
```

**One namespace per shared group.** The namespace name is the group name
(`darius-lukas`), and it determines both the Yjs document and the GossipSub topic.
Groups are therefore isolated from each other: a peer in one group receives nothing
from another.

---

## Sync Mechanisms

### 1. GossipSub — live updates

Every local change to a `Y.Text` produces a compact binary delta, published to the
namespace's topic:

```
topic: social-llm-wiki/v1/darius-lukas
```

Origin tracking (`'remote'`) prevents re-broadcasting received updates.

**Limitation:** fire-and-forget. A peer offline during an edit never receives that
delta — the gap the sync protocol closes.

Note that the relay does **not** gossip. Peers find each other by dialing the other's
circuit address; the relay only carries the connection.

### 2. `/wiki-sync/1.0.0` — full-state exchange

When two nodes connect, each sends its complete Yjs state:

```
peer:connect
  → dialProtocol('/wiki-sync/1.0.0')
  → send Y.encodeStateAsUpdate(doc)
  ← receive full state from peer
  → Y.applyUpdate(doc, state, 'peer-sync')
```

Yjs merges are idempotent, so sending full state is always safe. A 300 ms delay after
`peer:connect` lets the connection settle and the peer register its handler.

---

## File-Bridge

`packages/sync/src/file-bridge.js` keeps the Yjs document and the filesystem in sync,
so any tool writing Markdown (edit server, MCP, manual edits, the agent) reaches the
peers, and remote updates land on disk for Quartz to serve.

```
Filesystem (.md files)
    │  fs.watch → publish gate → read
    │                            ↑ skip if content == Yjs (avoid loop)
    ▼
Y.Text  ─── update event ──────► GossipSub publish
    │                            (origin !== 'local-file')
    └── observe (origin check) → writeFile / unlink
```

Circular update prevention: writes from Yjs to disk use `'local-file'` as the
transaction origin, and the `fs.watch` handler skips when file content already equals
the Yjs value. One file change → one Yjs update → one broadcast, no loops.

### Publish gate

Local content passes a gate before entering the document — at **both** entry points,
the watcher and the startup load. The latter matters because a page edited while the
node was down would otherwise be published on the next boot.

The gate implements the shared-branch privacy rule: a `[[wikilink]]` pointing at a page
outside the group would dangle on the peer's side *and* disclose a private page's name,
so such a page is withheld. Link resolution mirrors `wiki-lint.py` — filename stem, else
slugified title, umlauts transliterated, code blocks stripped — so the checkpoints never
disagree. A target resolving nowhere is published: it names no existing page.

A withheld page keeps its local file. If it was already published, peers keep the last
version that passed — the failure mode is a stale peer copy, never a leaked one.
Refusals go to stderr and to `<stateDir>/blocked-<namespace>.json`.

Incoming pages are **not** gated. The concern is what leaves this machine.

The gate is off unless `pagesRoot` is supplied, so callers that do not pass it keep the
previous behaviour.

### Deletions

Deletions travel in both directions: a removed local file drops the page from the
document, and a page a peer removes is unlinked locally. Two cases need care.

A save that writes a temporary file and renames it over the target makes the page
briefly absent. A deletion is therefore confirmed only after a grace period (3 s) and
re-checked before it is applied.

A deletion made while the node was down leaves no event, so startup reconciles the
document against the disk. At that point the document holds only our own persisted
state — no peer has connected yet — so a page present in the document but missing on
disk was deleted locally. The exception: an empty directory beside a non-empty document
is far more likely to be a wiki that has not been materialized yet than a deliberate
deletion of everything, so the old restore behaviour stands there and says so in the log.

---

## State Persistence

Yjs state is saved as a binary snapshot, debounced 2 s:

```
<stateDir>/darius_lukas.bin     ← namespace name, non-alphanumerics replaced
<stateDir>/node-id.key          ← Ed25519 identity
<stateDir>/blocked-<ns>.json    ← pages withheld by the publish gate
```

`stateDir` is deliberately configurable and kept **outside** the wiki tree: the group
directory is watched by other tooling (Quartz, the file-bridge itself), and binary state
inside it would be picked up as content.

On startup the snapshot loads before any peer connects, so the node is current from disk
alone; the full-state exchange then brings in whatever happened while it was offline.

---

## Connection Supervision

Relay and peers used to be dialled exactly once at startup. When the connection later
dropped, the node kept running with zero connections — healthy in `systemctl status`,
publishing to nobody, silent in the log. That happened in production for about fourteen
hours.

Each dial target now has a supervisor that re-dials until connected, starting at 5 s and
doubling to a 5 min ceiling. Drops are noticed two ways: `peer:disconnect` triggers an
immediate retry from the short end of the backoff, and a 30 s liveness check catches
drops that fire no event. Only state transitions are logged, so a healthy node stays quiet.

Connectedness is determined by matching the target's peer id against the open
connections. `multiaddr` v13 has no `getPeerId()`; the id comes from the address
components, taking the **last** `/p2p/` — a circuit address carries both the relay's id
and the destination's, and only the latter identifies the peer at the far end.

---

## Node Lifecycle

```
createWikiNode(opts)
  1. Load persisted Yjs state (if any)
  2. Load or create the Ed25519 identity (keyFile)
  3. Create libp2p node (TCP, Yamux, Noise, GossipSub, Identify, circuit-relay)
  4. Register GossipSub update handlers
  5. Register /wiki-sync/1.0.0 inbound handler
  6. Register peer:connect → full-state push
  7. Start file-bridge (gate + load existing files, reconcile deletions, watch)
  8. node.start() + subscribe to the namespace topic
  9. Supervise the relay connection, wait for the reservation
 10. Supervise each configured peer connection
```

Step 7 runs **before** step 8 deliberately — the deletion reconciliation in the
file-bridge relies on the document holding only local persisted state at that moment.

---

## NAT Traversal

Both peers sit behind home routers, so neither can accept inbound connections. A public
relay node running `@libp2p/circuit-relay-v2` accepts reservations; each node dials the
relay, and peers reach each other by dialing the other's circuit address.

Two things about the relay that are easy to get wrong:

- **Major versions must line up.** A relay on `circuit-relay-v2@3.x` with `identify@3.x`
  will let a v4 client's reservation run into a timeout rather than fail loudly.
- **The default data limit must be lifted.** circuit-relay-v2 caps relayed connections
  (~128 KB / 2 min) because it expects the relay to be used only for connection
  establishment. With `reservations: { applyDefaultLimit: false }` the traffic flows
  through the relay for good — NAT-independent, and unproblematic at wiki text volumes.

---

## Configuration

```js
import { createWikiNode } from '@social-llm-wiki/sync'

const { node, doc, pages, multiaddr, stop } = await createWikiNode({
  wikiRoot:  '/…/wiki/pages/social',  // parent of the group folder
  namespace: 'darius-lukas',          // group = Yjs doc + GossipSub topic
  pagesRoot: '/…/wiki/pages',         // enables the publish gate
  stateDir:  '~/.local/state/…',      // keep binary state out of the wiki tree
  keyFile:   '~/.local/state/…/node-id.key',
  relay:     '/ip4/…/tcp/4001/p2p/…',
  peers:     ['/ip4/…/p2p-circuit/p2p/…'],
  port:      0,                       // 0 = random
  // reconnectMinMs / reconnectMaxMs / reconnectCheckMs override the supervision timings
})
```

The wiki directory synced is `<wikiRoot>/<namespace>`. Return value: `node` (raw libp2p),
`doc`, `pages`, `multiaddr`, `stop()`.

`social-sync-node.mjs` in the repo root is the launcher used in production; it reads all
of the above from environment variables and derives `pagesRoot` from `WIKI_SOCIAL_ROOT`'s
parent unless told otherwise.

---

## Production Deployment

One node on the Raspberry Pi, one on the collaborator's machine, a relay on a Hetzner
server. Both nodes have stable PeerIDs from their key files, so dial addresses stay valid
across restarts. The Pi node is scoped to `pages/social/` and runs as a systemd user unit
(`wiki-social-sync.service`).

The user journal is not persisted on the Pi, so the unit logs to files
(`logs/social-sync.log`, `logs/social-sync.error.log`). Withheld pages and connection
transitions would otherwise be invisible.

**Diagnosing "nothing is syncing":** a live process is not a connected node. Check
`ss -tnp | grep <MainPID>` — no sockets means isolated, whatever the service status says.

---

## Security

- All connections are encrypted (Noise), and peers are identified by PeerID.
- There is **no authorization on ingress**: any peer that can reach a node and knows the
  topic can push updates into that namespace. The peer set is small and known, and
  addresses are not published — that is the whole of the access control.
- The publish gate controls **egress only**. It prevents a private page's name from
  leaving; it does not restrict what a peer may send.
- UCAN-based authorization was planned and never built. See the dropped-work table in
  [konzept.md](konzept.md).

---

## Files

| File | Role |
|---|---|
| `src/wiki-node.js` | Entry point — assembles libp2p, Yjs, bridge, supervision |
| `src/file-bridge.js` | Bidirectional Yjs ↔ filesystem, publish gate, deletions |
| `src/link-policy.js` | The shared-branch privacy rule |
| `src/persist.js` | Binary state persistence (load/save/debounce) |
| `src/index.js` | Public exports |
