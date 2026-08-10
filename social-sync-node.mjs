// Social-branch P2P sync node. Bridges pages/social/ (Yjs CRDT) to peers via
// the Hetzner libp2p relay. Same launcher for the Pi and for Lukas — all
// config via env.
//
//   WIKI_SOCIAL_ROOT  parent of the `social/` folder (wikiDir = <root>/social)
//   WIKI_STATE_DIR    where Yjs binary state + the node identity live
//   WIKI_KEY_FILE     persisted Ed25519 identity (stable PeerID)
//   WIKI_RELAY        relay multiaddr (reservation)
//   WIKI_PEERS        comma-separated peer multiaddrs to dial (Lukas dials the Pi)
import { createWikiNode } from './packages/sync/src/wiki-node.js'
import { join } from 'node:path'

const RELAY = process.env.WIKI_RELAY
  || '/ip4/46.225.213.61/tcp/4001/p2p/12D3KooWBsYoFG7J1xq6dEQTbZyN1qULncYXRirYgSEb12fYMaKL'
const wikiRoot = process.env.WIKI_SOCIAL_ROOT || '/home/darius/nanoclaw/groups/main/memory/wiki/pages'
const stateDir = process.env.WIKI_STATE_DIR || '/home/darius/.local/state/wiki-social-sync'
const keyFile = process.env.WIKI_KEY_FILE || join(stateDir, 'node-id.key')
const peers = (process.env.WIKI_PEERS || '').split(',').map(s => s.trim()).filter(Boolean)

const { node, stop } = await createWikiNode({
  wikiRoot, namespace: 'social', relay: RELAY, peers, stateDir, keyFile,
})
console.log('social-sync node up — PeerID:', node.peerId.toString())
setTimeout(() => {
  const circ = node.getMultiaddrs().map(a => a.toString()).find(a => a.includes('p2p-circuit'))
  if (circ) console.log('circuit address (peers dial this):', circ)
}, 4000)

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { try { await stop() } finally { process.exit(0) } })
}
