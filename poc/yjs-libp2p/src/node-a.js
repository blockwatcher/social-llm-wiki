/**
 * PoC Node A — startet auf Port 7701, schreibt Wiki-Seiten sobald Node B verbindet.
 *
 * Starten:  node poc/yjs-libp2p/src/node-a.js
 * Parallel: node poc/yjs-libp2p/src/node-b.js <multiaddr-von-A>
 */

import * as Y from 'yjs'
import { createWikiNode, WIKI_TOPIC } from './create-node.js'

const { node, doc, pages } = await createWikiNode({ port: 7701, name: 'Node-A' })

console.log('[Node-A] Eigene Multiaddr (für Node-B):')
console.log(`         ${node.getMultiaddrs()[0]}`)
console.log('[Node-A] Warte auf Peer ...\n')

let written = false

node.services.pubsub.addEventListener('subscription-change', (evt) => {
  const joined = evt.detail.subscriptions.some(
    (s) => s.topic === WIKI_TOPIC && s.subscribe,
  )
  if (!joined || written) return
  written = true

  console.log('[Node-A] Peer beigetreten — schreibe Seiten ins Wiki ...')

  // Seite "home" anlegen
  const home = new Y.Text()
  pages.set('home', home)
  home.insert(0, '# Social LLM Wiki\n\nWillkommen! Dies ist eine gemeinsam kuratierte Seite.')

  // Seite "konzept" anlegen
  const konzept = new Y.Text()
  pages.set('konzept', konzept)
  konzept.insert(0, '# Konzept\n\nDezentrales Wiki mit Yjs CRDTs + libp2p GossipSub.')

  console.log('[Node-A] Seiten angelegt: home, konzept')
  console.log('[Node-A] Aktueller Zustand:')
  printState(pages)

  // Nach 2s einen Edit simulieren
  setTimeout(() => {
    home.insert(home.length, '\n\nEdit von Node-A (concurrent möglich!).')
    console.log('\n[Node-A] Edit auf "home" vorgenommen:')
    printState(pages)
  }, 2000)
})

// Eingehende Remote-Änderungen loggen
doc.on('update', (_update, origin) => {
  if (origin !== 'remote') return
  console.log('\n[Node-A] Remote-Update empfangen — neuer Zustand:')
  printState(pages)
})

function printState(pages) {
  for (const [name, text] of pages.entries()) {
    console.log(`  [${name}]: ${text.toString().slice(0, 80).replace(/\n/g, '↵')}`)
  }
}

// Event Loop am Leben halten
const keepAlive = setInterval(() => {}, 60_000)

process.on('SIGINT', async () => {
  clearInterval(keepAlive)
  await node.stop()
  process.exit(0)
})
