import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import * as Y from 'yjs'
import { join } from 'node:path'
import { loadState, makeDebouncedSave } from './persist.js'
import { createFileBridge } from './file-bridge.js'

// GossipSub topic per namespace — isolates personal and shared namespaces
function topicFor(namespace) {
  return `social-llm-wiki/v1/${namespace}`
}

// Custom libp2p protocol for full-state exchange when a peer connects.
// GossipSub only delivers messages to currently subscribed peers;
// a joining peer misses all prior updates. This protocol closes that gap.
const SYNC_PROTOCOL = '/wiki-sync/1.0.0'

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
 * @returns {Promise<{ node, doc, pages, multiaddr: string, stop: () => Promise<void> }>}
 */
export async function createWikiNode({
  wikiRoot,
  namespace = '@darius',
  port = 0,
  peers = [],
  relay = null,   // multiaddr string of a circuit relay server
} = {}) {
  const topic = topicFor(namespace)
  const wikiDir = join(wikiRoot, namespace)
  const stateDir = join(wikiRoot, '.yjs')

  // --- Yjs doc ---
  const doc = new Y.Doc()
  const pages = doc.getMap('pages')

  // Load persisted state before connecting to peers
  await loadState(doc, stateDir, namespace)

  const scheduleSave = makeDebouncedSave(doc, stateDir, namespace)

  // --- libp2p node ---
  // Circuit relay transport is included so nodes behind NAT can connect
  // via a public relay server using circuit relay v2 addresses.
  // NOTE: Do NOT add /p2p-circuit to listen addresses — dial the relay after
  // start; circuitRelayTransport() will automatically make a reservation and
  // announce the circuit multiaddr.
  const listenAddrs = [`/ip4/0.0.0.0/tcp/${port}`]
  if (relay) listenAddrs.push('/p2p-circuit')

  const node = await createLibp2p({
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
  node.handle(SYNC_PROTOCOL, async ({ stream }) => {
    try {
      const chunks = []
      for await (const chunk of stream.source) {
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
        await stream.sink((async function* () { yield state })())
      } catch {
        // Normal: other side may not have our protocol or beat us to it
      }
    }, 300)
  })

  // --- File-bridge: Yjs ↔ filesystem ---
  const bridge = await createFileBridge(doc, pages, wikiDir)

  // --- Start node and subscribe ---
  await node.start()
  node.services.pubsub.subscribe(topic)

  const multiaddr = node.getMultiaddrs()[0]?.toString() ?? '(no address)'
  console.log(`[sync:${namespace}] started: ${multiaddr}`)

  // --- Dial relay first (before initial peers) ---
  // circuitRelayTransport() will make a v2 reservation and announce the
  // circuit address once the relay connection is established.
  if (relay) {
    try {
      const { multiaddr: ma } = (await import('@multiformats/multiaddr'))
      await node.dial(ma(relay))
      console.log(`[sync:${namespace}] connected to relay: ${relay}`)
      // Give the relay a moment to complete the reservation
      await new Promise(r => setTimeout(r, 1000))
      const addrs = node.getMultiaddrs().map(a => a.toString())
      console.log(`[sync:${namespace}] announced addresses:`, addrs)
    } catch (err) {
      console.warn(`[sync:${namespace}] could not connect to relay ${relay}: ${err.message}`)
    }
  }

  // --- Dial initial peers ---
  for (const addr of peers) {
    try {
      const { multiaddr: ma } = (await import('@multiformats/multiaddr'))
      await node.dial(ma(addr))
      console.log(`[sync:${namespace}] connected to peer: ${addr}`)
    } catch (err) {
      console.warn(`[sync:${namespace}] could not connect to ${addr}: ${err.message}`)
    }
  }

  // --- Clean stop ---
  async function stop() {
    bridge.stop()
    await node.stop()
    console.log(`[sync:${namespace}] stopped`)
  }

  return { node, doc, pages, multiaddr, stop }
}
