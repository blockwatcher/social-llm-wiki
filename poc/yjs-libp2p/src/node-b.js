/**
 * PoC Node B — verbindet sich mit Node A, empfängt Seiten, macht eigene Edits.
 *
 * Starten:  node poc/yjs-libp2p/src/node-b.js <multiaddr-von-A>
 *
 * Beispiel:
 *   node poc/yjs-libp2p/src/node-b.js /ip4/127.0.0.1/tcp/7701/p2p/12D3KooW...
 */

import { multiaddr } from '@multiformats/multiaddr'
import * as Y from 'yjs'
import { createWikiNode } from './create-node.js'

const targetAddr = process.argv[2]
if (!targetAddr) {
  console.error('Usage: node src/node-b.js <multiaddr-von-node-a>')
  process.exit(1)
}

const { node, doc, pages } = await createWikiNode({ name: 'Node-B' })

console.log('[Node-B] Verbinde mit Node-A:', targetAddr)
await node.dial(multiaddr(targetAddr))
console.log('[Node-B] Verbunden!\n')

// Eingehende Remote-Änderungen loggen
doc.on('update', (_update, origin) => {
  if (origin !== 'remote') return
  console.log('\n[Node-B] Remote-Update empfangen — neuer Zustand:')
  printState(pages)

  // Sobald wir "home" kennen, fügen wir einen eigenen Edit hinzu (einmalig)
  if (!_didOwnEdit && pages.has('home')) {
    _didOwnEdit = true
    setTimeout(() => {
      const home = pages.get('home')
      home.insert(home.length, '\n\nEdit von Node-B — CRDT löst Konflikte automatisch!')
      console.log('\n[Node-B] Eigener Edit auf "home":')
      printState(pages)
    }, 1000)
  }
})

let _didOwnEdit = false

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
