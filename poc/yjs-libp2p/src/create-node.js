import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@libp2p/gossipsub'
import { identify } from '@libp2p/identify'
import * as Y from 'yjs'
import { fromString, toString } from 'uint8arrays'

export const WIKI_TOPIC = 'social-llm-wiki/sync/v1'

// Kein decodeRpcLimits mehr: CVE-2026-46679 (GossipSub-Subscription-Flood-DoS) ist
// seit @libp2p/gossipsub@16.x upstream behoben — die RPC-Decode-Limits sind dort
// endlich vorbelegt, und die zwei Härtungen, die sich nur im Code beheben lassen
// (Per-Peer-Subscription-Zähler, Aufräumen leerer Sets), sind mit drin. Die früher
// hier von Hand gespiegelten Limits sind damit überflüssig.
// Siehe docs/libp2p-v3-migration.md.

/**
 * Erstellt einen libp2p-Node mit GossipSub und einem Yjs-Dokument.
 * Änderungen am Yjs-Dokument werden automatisch an alle Peers gepusht.
 * Eingehende Updates werden automatisch in das lokale Dokument gemergt.
 *
 * @param {{ port?: number, name?: string }} options
 * @returns {{ node, doc, pages }}
 */
export async function createWikiNode({ port = 0, name = 'node' } = {}) {
  const node = await createLibp2p({
    addresses: { listen: [`/ip4/127.0.0.1/tcp/${port}`] },
    transports: [tcp()],
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

  await node.start()

  const doc = new Y.Doc()
  // pages: Map von Seitenname → Y.Text
  const pages = doc.getMap('pages')

  // Lokale Yjs-Änderungen → GossipSub broadcasten
  doc.on('update', (update, origin) => {
    if (origin === 'remote') return // eigene Remote-Updates nicht re-broadcasten
    const encoded = toString(update, 'base64')
    node.services.pubsub
      .publish(WIKI_TOPIC, fromString(encoded, 'utf8'))
      .catch(() => {}) // silent wenn noch keine Peers
  })

  // Eingehende GossipSub-Nachrichten → Yjs-Update anwenden
  node.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== WIKI_TOPIC) return
    const update = fromString(toString(evt.detail.data, 'utf8'), 'base64')
    Y.applyUpdate(doc, update, 'remote')
  })

  node.services.pubsub.subscribe(WIKI_TOPIC)

  const addr = node.getMultiaddrs()[0]?.toString() ?? '(no address)'
  console.log(`[${name}] gestartet: ${addr}`)

  return { node, doc, pages }
}
