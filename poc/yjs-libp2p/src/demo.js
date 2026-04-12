/**
 * Demo: Zwei Wiki-Nodes im selben Prozess, kommunizieren über libp2p GossipSub.
 * Zeigt CRDT-Sync in Aktion.
 *
 * Starten: node poc/yjs-libp2p/src/demo.js
 */

import * as Y from 'yjs'
import { createWikiNode, WIKI_TOPIC } from './create-node.js'

console.log('=== Social LLM Wiki — Yjs + libp2p GossipSub PoC ===\n')

// Zwei Nodes starten
const a = await createWikiNode({ port: 7801, name: 'Node-A' })
const b = await createWikiNode({ port: 7802, name: 'Node-B' })

// B verbindet sich mit A
await b.node.dial(a.node.getMultiaddrs()[0])
console.log('[Demo] Verbindung hergestellt\n')

// Auf Updates loggen
function watchDoc(name, doc, pages) {
  doc.on('update', (_update, origin) => {
    if (origin !== 'remote') return
    console.log(`\n[${name}] Remote-Update — Seiten:`)
    for (const [k, v] of pages.entries()) {
      console.log(`  "${k}": ${v.toString().slice(0, 60).replace(/\n/g, '↵')}`)
    }
  })
}
watchDoc('Node-A', a.doc, a.pages)
watchDoc('Node-B', b.doc, b.pages)

// GossipSub braucht einen Moment zum Mesh-Aufbau
await new Promise((r) => setTimeout(r, 1500))

// --- Schritt 1: Node A erstellt Seite "home" ---
console.log('[Demo] Schritt 1: Node-A erstellt Seite "home"')
const homeA = new Y.Text()
a.pages.set('home', homeA)
homeA.insert(0, '# Social LLM Wiki\nWillkommen!')
await new Promise((r) => setTimeout(r, 800))

// --- Schritt 2: Node B erstellt Seite "konzept" ---
console.log('\n[Demo] Schritt 2: Node-B erstellt Seite "konzept"')
const konzeptB = new Y.Text()
b.pages.set('konzept', konzeptB)
konzeptB.insert(0, '# Konzept\nDezentrales P2P Wiki mit CRDTs.')
await new Promise((r) => setTimeout(r, 800))

// --- Schritt 3: Concurrent edits auf "home" ---
console.log('\n[Demo] Schritt 3: Concurrent edits auf "home" von A und B')
// A editiert "home"
homeA.insert(homeA.length, '\n— Edit von Kai (Node-A)')

// B hat jetzt auch "home" (via Sync) — concurrent edit
const homeB = b.pages.get('home')
if (homeB) {
  homeB.insert(homeB.length, '\n— Edit von Horst Duda (Node-B)')
}

await new Promise((r) => setTimeout(r, 1000))

// --- Endergebnis ---
console.log('\n=== Endergebnis (nach CRDT-Merge) ===')
console.log('\n[Node-A] Seiten:')
for (const [k, v] of a.pages.entries()) {
  console.log(`  "${k}":\n    ${v.toString().replace(/\n/g, '\n    ')}`)
}
console.log('\n[Node-B] Seiten:')
for (const [k, v] of b.pages.entries()) {
  console.log(`  "${k}":\n    ${v.toString().replace(/\n/g, '\n    ')}`)
}

const aPages = [...a.pages.keys()].sort().join(',')
const bPages = [...b.pages.keys()].sort().join(',')
console.log(`\n[Demo] Seiten konvergiert: ${aPages === bPages ? '✓ JA' : '✗ NEIN (Bug!)'}`)

await a.node.stop()
await b.node.stop()
console.log('\n[Demo] Nodes gestoppt. PoC erfolgreich.')
