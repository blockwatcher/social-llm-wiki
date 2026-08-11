import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@libp2p/gossipsub'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import * as Y from 'yjs'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { loadState, makeDebouncedSave } from './persist.js'

// Load a persisted Ed25519 identity from disk, or generate and save one.
// A stable PeerID is required for other peers to dial this node reliably
// (a circuit multiaddr embeds the PeerID).
async function loadOrCreateKey(keyFile) {
  try {
    return privateKeyFromProtobuf(await readFile(keyFile))
  } catch {
    const pk = await generateKeyPair('Ed25519')
    await mkdir(dirname(keyFile), { recursive: true })
    await writeFile(keyFile, privateKeyToProtobuf(pk), { mode: 0o600 })
    return pk
  }
}
import { multiaddr } from '@multiformats/multiaddr'
import { createFileBridge } from './file-bridge.js'
import { createLinkPolicy } from './link-policy.js'

/**
 * Keep one dial target (the relay, or a peer) connected.
 *
 * Relay and peers used to be dialled exactly once at startup. When that connection
 * later dropped — as the Pi's relay connection did — the process stayed up, published
 * nothing, and logged nothing: a node that looks healthy in `systemctl status` while
 * being completely isolated. Each target now gets a supervisor that re-dials with
 * exponential backoff, and says so both when it loses and when it regains the link.
 *
 * A drop is noticed two ways: libp2p's peer:disconnect event triggers an immediate
 * retry, and a periodic check catches drops that produced no event.
 */
function superviseConnection({ node, namespace, label, addr, minDelayMs, maxDelayMs, checkMs }) {
  const target = multiaddr(addr)
  // A circuit address carries two /p2p/ components — the relay's and the destination's.
  // The last one is who we actually end up connected to.
  const p2p = target.getComponents().filter((c) => c.name === 'p2p')
  const peerId = p2p.at(-1)?.value ?? null
  let delay = minDelayMs
  let timer = null
  let stopped = false
  let connected = false

  // Without a /p2p/ component we cannot tell whether the target is connected, so
  // supervision would degrade into dialling on every tick. Dial once and stay quiet.
  const supervisable = peerId !== null

  const isConnected = () =>
    node.getConnections().some((c) => c.remotePeer.toString() === peerId)

  const arm = (ms) => {
    if (stopped || !supervisable) return
    clearTimeout(timer)
    timer = setTimeout(tick, ms)
    timer.unref?.()
  }

  async function tick() {
    if (stopped) return
    timer = null

    if (supervisable && isConnected()) {
      if (!connected) {
        console.log(`[sync:${namespace}] ${label} connected: ${addr}`)
        connected = true
      }
      delay = minDelayMs
      arm(checkMs)
      return
    }

    if (connected) {
      console.warn(`[sync:${namespace}] ${label} connection lost, reconnecting: ${addr}`)
      connected = false
    }

    try {
      await node.dial(target)
      console.log(`[sync:${namespace}] ${label} connected: ${addr}`)
      connected = true
      delay = minDelayMs
      arm(checkMs)
    } catch (err) {
      if (supervisable) {
        console.warn(
          `[sync:${namespace}] ${label} dial failed, retry in ${Math.round(delay / 1000)}s: ${err.message}`,
        )
        arm(delay)
        delay = Math.min(delay * 2, maxDelayMs)
      } else {
        console.warn(`[sync:${namespace}] could not connect to ${addr}: ${err.message}`)
      }
    }
  }

  return {
    start: () => tick(),
    // A disconnect is the strongest signal there is — retry now rather than at the
    // next periodic check, and from the short end of the backoff.
    onDisconnect(id) {
      if (stopped || !supervisable || id !== peerId) return
      delay = minDelayMs
      arm(minDelayMs)
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

// GossipSub topic per namespace — isolates personal and shared namespaces
function topicFor(namespace) {
  return `social-llm-wiki/v1/${namespace}`
}

// Custom libp2p protocol for full-state exchange when a peer connects.
// GossipSub only delivers messages to currently subscribed peers;
// a joining peer misses all prior updates. This protocol closes that gap.
const SYNC_PROTOCOL = '/wiki-sync/1.0.0'

// CVE-2026-46679 (GossipSub subscription-flood DoS) is fixed upstream: since
// @libp2p/gossipsub@16.x the RPC decode limits (maxSubscriptions: 5000, …) are
// finite by default, so the previous explicit decodeRpcLimits backport is no
// longer needed.

function mergeUint8Arrays(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

/**
 * Create a production wiki sync node.
 *
 * Combines:
 *  - libp2p (TCP + Yamux + Noise) for transport
 *  - GossipSub for live CRDT update broadcast
 *  - Custom /wiki-sync/1.0.0 protocol for full-state exchange on peer connect
 *  - Yjs CRDT for conflict-free concurrent editing
 *  - File-bridge for bidirectional Yjs ↔ filesystem sync
 *  - Persistence: Yjs state survives restarts
 *
 * @param {object} opts
 * @param {string}   opts.wikiRoot   - Path to wiki root (e.g. /home/darius/.../wiki)
 * @param {string}   [opts.namespace]  - Namespace to sync (default: '@darius')
 * @param {number}   [opts.port]       - TCP listen port (default: 0 = random)
 * @param {string[]} [opts.peers]      - Multiaddrs to dial on startup
 * @param {string}   [opts.pagesRoot]  - The wiki's whole `pages/` tree. Enables the
 *                                       publish gate: a local page whose [[wikilinks]]
 *                                       point outside the synced group is withheld from
 *                                       peers, since the link would both dangle there
 *                                       and disclose a private page's name. Omit to
 *                                       publish unconditionally (previous behaviour).
 * @returns {Promise<{ node, doc, pages, multiaddr: string, stop: () => Promise<void> }>}
 */
export async function createWikiNode({
  wikiRoot,
  namespace = '@darius',
  port = 0,
  peers = [],
  relay = null,   // multiaddr string of a circuit relay server
  stateDir = null, // override Yjs state dir; defaults to <wikiRoot>/.yjs
  keyFile = null,  // path to a persisted identity; null = ephemeral random PeerID
  pagesRoot = null, // enables the publish gate; see above
  reconnectMinMs = 5_000,    // first retry delay after a lost connection
  reconnectMaxMs = 300_000,  // backoff ceiling
  reconnectCheckMs = 30_000, // liveness check for drops that fire no event
} = {}) {
  const topic = topicFor(namespace)
  const wikiDir = join(wikiRoot, namespace)
  // Keep the binary Yjs state out of the wiki content tree when overridden —
  // e.g. when wikiDir is a live wiki subfolder watched by other tooling.
  const resolvedStateDir = stateDir ?? join(wikiRoot, '.yjs')

  // --- Yjs doc ---
  const doc = new Y.Doc()
  const pages = doc.getMap('pages')

  // Load persisted state before connecting to peers
  await loadState(doc, resolvedStateDir, namespace)

  const scheduleSave = makeDebouncedSave(doc, resolvedStateDir, namespace)

  // --- libp2p node ---
  // Circuit relay transport is included so nodes behind NAT can connect
  // via a public relay server using circuit relay v2 addresses.
  // NOTE: Do NOT add /p2p-circuit to listen addresses — dial the relay after
  // start; circuitRelayTransport() will automatically make a reservation and
  // announce the circuit multiaddr.
  const listenAddrs = [`/ip4/0.0.0.0/tcp/${port}`]
  if (relay) listenAddrs.push('/p2p-circuit')

  const privateKey = keyFile ? await loadOrCreateKey(keyFile) : undefined

  const node = await createLibp2p({
    ...(privateKey ? { privateKey } : {}),
    addresses: { listen: listenAddrs },
    transports: [tcp(), circuitRelayTransport({ discoverRelays: relay ? 1 : 0 })],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      }),
    },
  })

  // --- GossipSub: local Yjs updates → broadcast ---
  doc.on('update', (update, origin) => {
    if (origin === 'remote' || origin === 'peer-sync' || origin === 'persist') return
    node.services.pubsub
      .publish(topic, update)
      .catch(() => {}) // silent when no peers yet
    scheduleSave()
  })

  // --- GossipSub: incoming updates → merge into Yjs ---
  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== topic) return
    Y.applyUpdate(doc, evt.detail.data, 'remote')
    scheduleSave()
  })

  // --- Sync protocol: send full state to newly connected peers ---
  // Registers an inbound handler so peers can request our state
  node.handle(SYNC_PROTOCOL, async (stream, connection) => {
    try {
      const chunks = []
      for await (const chunk of stream) {
        chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())
      }
      const state = mergeUint8Arrays(chunks)
      if (state.length > 0) {
        Y.applyUpdate(doc, state, 'peer-sync')
        scheduleSave()
      }
    } catch {
      // Stream closed early — normal during shutdown
    }
  })

  // When a peer connects, send them our full current state after a short delay
  // (delay lets the connection settle and the peer register their handler)
  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.remotePeer ?? evt.detail
    setTimeout(async () => {
      try {
        const stream = await node.dialProtocol(peerId, SYNC_PROTOCOL)
        const state = Y.encodeStateAsUpdate(doc)
        // libp2p 3.x MessageStream: send() is sync (false = buffer full), then close() flushes.
        if (stream.send(state) === false) {
          await stream.onDrain()
        }
        await stream.close()
      } catch {
        // Normal: other side may not have our protocol or beat us to it
      }
    }, 300)
  })

  // --- File-bridge: Yjs ↔ filesystem ---
  // The blocked-pages report goes to the state dir, not into wikiDir — anything written
  // there would itself be published to the peers.
  const blockedPath = join(resolvedStateDir, `blocked-${namespace.replace(/[^\w.-]/g, '_')}.json`)
  const blocked = new Map()

  const bridge = await createFileBridge(doc, pages, wikiDir, {
    gate: pagesRoot ? createLinkPolicy({ pagesRoot, groupDir: wikiDir }) : undefined,
    onDeleted: (key) => {
      console.log(`[sync:${namespace}] page removed, deletion propagated: ${key}`)
      if (blocked.delete(key)) {
        writeFile(blockedPath, JSON.stringify(Object.fromEntries(blocked), null, 2), 'utf8')
          .catch(() => {})
      }
    },
    onBlocked: (key, reason) => {
      console.error(`[sync:${namespace}] WITHHELD ${key}: ${reason}`)
      blocked.set(key, { reason, at: new Date().toISOString() })
      mkdir(resolvedStateDir, { recursive: true })
        .then(() => writeFile(
          blockedPath,
          JSON.stringify(Object.fromEntries(blocked), null, 2),
          'utf8',
        ))
        .catch((err) => console.error(`[sync:${namespace}] blocked-report write failed:`, err.message))
    },
  })

  // --- Start node and subscribe ---
  await node.start()
  node.services.pubsub.subscribe(topic)

  const multiaddr = node.getMultiaddrs()[0]?.toString() ?? '(no address)'
  console.log(`[sync:${namespace}] started: ${multiaddr}`)

  // --- Keep relay and peers connected ---
  // circuitRelayTransport() will make a v2 reservation and announce the circuit
  // address once the relay connection is established, so the relay goes first.
  const supervisors = []
  const supervise = (label, addr) => {
    const sup = superviseConnection({
      node, namespace, label, addr,
      minDelayMs: reconnectMinMs, maxDelayMs: reconnectMaxMs, checkMs: reconnectCheckMs,
    })
    supervisors.push(sup)
    return sup.start()
  }

  node.addEventListener('peer:disconnect', (evt) => {
    const id = evt.detail?.toString?.()
    if (!id) return
    for (const sup of supervisors) sup.onDisconnect(id)
  })

  if (relay) {
    await supervise('relay', relay)
    // Give the relay a moment to complete the reservation
    await new Promise((r) => setTimeout(r, 1000))
    console.log(`[sync:${namespace}] announced addresses:`, node.getMultiaddrs().map((a) => a.toString()))
  }

  for (const addr of peers) await supervise('peer', addr)

  // --- Clean stop ---
  async function stop() {
    for (const sup of supervisors) sup.stop()
    bridge.stop()
    await node.stop()
    console.log(`[sync:${namespace}] stopped`)
  }

  return { node, doc, pages, multiaddr, stop }
}
