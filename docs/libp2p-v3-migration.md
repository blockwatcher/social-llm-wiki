# Migrationsplan: libp2p 2.x → 3.x + `@libp2p/gossipsub` 16

**Status:** ✅ **durchgeführt** · **Erstellt:** 2026-06-19 · **Treiber:** CVE-2026-46679

> **Abgeschlossen.** `packages/sync` migriert am 2026-08-10 (`6a3062a`), der PoC am
> 2026-08-11. Der Baum enthält kein `@chainsafe/libp2p-gossipsub` mehr, `libp2p` löst
> überall auf 3.3.8 auf, und die von Hand gespiegelten `decodeRpcLimits` sind an beiden
> Stellen entfallen — die Limits sind seit `@libp2p/gossipsub@16.x` upstream vorbelegt,
> samt der zwei Härtungen, die sich nur im Code beheben ließen. Das Dokument bleibt als
> Beleg stehen: was geändert wurde und warum.
>
> Der Deployment-Hinweis unten ist überholt — der Sync-Layer läuft seit dem 2026-08-10
> produktiv als `wiki-social-sync.service`. Die DoS-Fläche war zum Migrationszeitpunkt
> latent, ist es jetzt aber nicht mehr; deshalb war die Reihenfolge (erst migrieren,
> dann in Betrieb nehmen) die richtige.

## 1. Ziel & Begründung

Das aktuell genutzte `@chainsafe/libp2p-gossipsub@14.1.2` ist eine **verwaiste Paketlinie**
(letzte Veröffentlichung 14.1.2, kein Patch mehr). Es ist von **CVE-2026-46679**
(Memory-DoS via Subscription-Flood) betroffen. Wir haben den Angriffsvektor bereits
per `decodeRpcLimits`-Konfiguration entschärft (siehe `packages/sync/src/wiki-node.js`),
aber zwei der drei Upstream-Härtungen (Per-Peer-Subscription-Zähler in
`handleReceivedSubscription`, Aufräumen leerer Sets in `removePeer`) lassen sich nur
durch Code beheben.

Der offizielle Fix lebt im umbenannten Paket **`@libp2p/gossipsub@≥15.0.23`**
(latest 16.0.3). Diese Linie verlangt `@libp2p/interface@^3` und damit den kompletten
**libp2p-3.x-Stack**. Ziel dieser Migration: zurück auf eine gepflegte Dependency-Linie,
**bevor** der P2P-Sync-Layer produktiv geht.

> **Aktueller Deployment-Status:** Der Sync-Layer (`packages/sync`) wird derzeit von
> keinem systemd-Dienst gestartet (laufende Units: `quartz-watcher`, `wiki-edit-server`,
> `wiki-mcp` — keiner nutzt gossipsub). Die DoS-Fläche ist also **latent**. Die
> Migration ist Vorarbeit, keine akute Incident-Response — entsprechend ohne Zeitdruck,
> aber vor dem ersten produktiven Sync-Daemon abzuschließen.

## 2. Scope

| Betroffen | Dateien | Priorität |
|---|---|---|
| Produktions-Sync-Layer | `packages/sync/package.json`, `packages/sync/src/wiki-node.js` | **Muss** — ✅ 2026-08-10 |
| PoC | `poc/yjs-libp2p/package.json`, `poc/yjs-libp2p/src/create-node.js` | Optional (dev-only) — ✅ 2026-08-11 |
| Lockfile | `package-lock.json` (npm workspaces) | Muss — ✅ |

Vom PoC waren nur zwei der fünf Code-Schritte aus §4 betroffen (gossipsub-Import,
`decodeRpcLimits` entfernen): er nutzt ausschließlich GossipSub, keine eigenen
Protokolle und keine Streams, also entfielen Handler-Signatur, `stream.source` und
`sink()`. Verifiziert mit `demo.js` (zwei In-Process-Nodes, Konvergenz bestätigt) und
mit `node-a.js`/`node-b.js` über einen echten TCP-Dial zwischen zwei Prozessen.

Nicht betroffen: `mcp-server`, `edit-server`, `graph`, `bot` (kein direkter
gossipsub-/Stream-Code). `bot` referenziert libp2p nur konzeptionell.

## 3. Versionsmatrix (geprüft gegen npm, Juni 2026)

| Paket | aktuell | Ziel | Anmerkung |
|---|---|---|---|
| `libp2p` | 2.10.0 | **3.3.4** | Major-Bump, Kern |
| `@libp2p/interface` | 2.11.0 | 3.x (transitiv) | bestimmt die ganze Generation |
| `@chainsafe/libp2p-gossipsub` | 14.1.2 | **entfernen** | verwaist |
| `@libp2p/gossipsub` | — | **16.0.3** | Ersatz, CVE-gefixt |
| `@libp2p/tcp` | 10.1.19 | **11.0.22** | |
| `@libp2p/identify` | 3.0.39 | **4.1.8** | |
| `@libp2p/circuit-relay-v2` | 4.2.2 | **4.2.7** | gleiche Major, aber 4.2.7 verlangt interface ^3 |
| `@chainsafe/libp2p-noise` | 16.1.5 | **17.0.0** | |
| `@chainsafe/libp2p-yamux` | 7.0.4 | **8.0.1** | |
| `@multiformats/multiaddr` | 12.5.1 | **13.0.3** | von libp2p 3 vorausgesetzt |
| `uint8arrays` (PoC) | 5.1.0 | **6.1.1** | nur PoC, API stabil |

## 4. Die eigentliche Arbeit — Code-Breaking-Changes

libp2p 3.0 hat **Streams von async-iterablen auf EventTargets/`MessageStream`**
umgestellt. Genau das trifft den custom `SYNC_PROTOCOL`-Handler. Vier konkrete Änderungen
in `packages/sync/src/wiki-node.js`:

### 4.1 gossipsub-Import tauschen
```diff
- import { gossipsub } from '@chainsafe/libp2p-gossipsub'
+ import { gossipsub } from '@libp2p/gossipsub'
```
Die Factory und die Optionen `emitSelf`, `allowPublishToZeroTopicPeers`,
`decodeRpcLimits` existieren in 16.x unverändert → der `gossipsub({...})`-Block bleibt
strukturell gleich.

### 4.2 `decodeRpcLimits`-Workaround vereinfachen
16.x hat **endliche Defaults eingebaut** (`maxSubscriptions: 5000` etc. — exakt die Werte,
die wir gebackportet haben). Der explizite Block + der lange CVE-Kommentar werden damit
**redundant**. Empfehlung: Block entfernen oder auf einen Einzeiler eindampfen
(„Defaults sind seit 16.x sicher"). Kein Verhaltensunterschied.

### 4.3 Handler-Signatur: Objekt → Positionsargumente
```diff
- node.handle(SYNC_PROTOCOL, async ({ stream }) => {
+ node.handle(SYNC_PROTOCOL, async (stream, connection) => {
```

### 4.4 Stream lesen: `stream.source` → Stream selbst (bleibt AsyncIterable)
`MessageStream` implementiert weiterhin `AsyncIterable<Uint8Array | Uint8ArrayList>`,
nur nicht mehr über `.source`:
```diff
-     for await (const chunk of stream.source) {
+     for await (const chunk of stream) {
        chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())
      }
```

### 4.5 Stream schreiben: `stream.sink(generator)` → `send()` + `close()`
```diff
        const stream = await node.dialProtocol(peerId, SYNC_PROTOCOL)
        const state = Y.encodeStateAsUpdate(doc)
-       await stream.sink((async function* () { yield state })())
+       stream.send(state)          // sync; false = Buffer voll
+       await stream.close()        // flush + write-Seite schließen
```
**Backpressure:** `send()` gibt `false` zurück, wenn der Sendepuffer voll ist. Für große
Yjs-States robust:
```js
if (stream.send(state) === false) {
  await stream.onDrain()           // wartet, bis wieder Platz ist
}
await stream.close()
```
Für ein persönliches Wiki ist der State klein → der einfache Pfad genügt; die
Drain-Variante ist die saubere Absicherung.

### 4.6 Unverändert (verifiziert gegen 3.x-Typen)
- `createLibp2p({ addresses, transports, streamMuxers, connectionEncrypters, services })`
  — alle Config-Keys gleich.
- `peer:connect` liefert die PeerId direkt als `evt.detail` (`CustomEvent<PeerId>`);
  das bestehende `evt.detail.remotePeer ?? evt.detail` funktioniert weiter.
- pubsub-`message`-Event hat weiterhin `.topic` und `.data`.
- `node.dial(ma(addr))`, `getMultiaddrs()`, `subscribe()`, `publish()`, `start()`,
  `stop()`, `dialProtocol()` — Signaturen unverändert.
- `@multiformats/multiaddr@13` exportiert weiterhin `multiaddr`.

## 5. Risiken & Laufzeit-Verifikation

Das Risiko liegt **nicht im Code-Volumen** (4 Edits), sondern in der Laufzeit-Interop:

1. **Circuit-Relay-v2-Reservierung** — der Relay-Dial + Announce-Pfad
   (`circuitRelayTransport({ discoverRelays })`, `node.dial(ma(relay))`, Reservierung,
   `/p2p-circuit`-Announce). In 3.x manuell gegen einen echten Relay testen, falls
   produktiv ein Relay genutzt wird.
2. **noise-17 / yamux-8-Handshake** — JS-API geändert, **Wire-Protokoll stabil**
   (`/noise`, `/yamux/1.0.0`). Beide Seiten müssen aber gemeinsam migrieren bzw. ein
   Cross-Version-Smoketest sollte bestätigen, dass ein 2.x- und ein 3.x-Node sich noch
   verstehen (Protokoll-IDs identisch → sollte halten).
3. **gossipsub-Wire-Kompatibilität** — 14.x und 16.x sprechen beide `/meshsub/1.x` →
   interop unkritisch.

## 6. Ausführungsschritte

1. Branch `feat/libp2p-v3` anlegen.
2. `packages/sync/package.json`: Versionen gemäß §3 anheben, `@chainsafe/libp2p-gossipsub`
   raus, `@libp2p/gossipsub` rein.
3. `npm install` im Repo-Root (workspaces) → Lockfile regenerieren.
4. `wiki-node.js`: §4.1–4.5 anwenden, §4.2 vereinfachen.
5. (Optional) PoC analog: `@libp2p/gossipsub`-Swap + `uint8arrays@6`.
6. **Smoke-Test** (siehe §7).
7. Relay-Pfad testen, falls relevant.
8. `npm audit` → keine gossipsub-Findings mehr; Lint laufen lassen.
9. Commit + (nach Review) Merge.

## 7. Verifikationsstrategie

Der bestehende `poc/yjs-libp2p/src/demo.js` startet zwei In-Process-Nodes und synct ein
Yjs-Doc — ideal als **Regressionstest für den Stream-Rewrite**: Eine Schreiboperation auf
Node A muss auf Node B ankommen. Das übt **beides** aus: gossipsub-Broadcast (live-Updates)
**und** den custom `SYNC_PROTOCOL`-Full-State-Austausch beim Connect.

Konkret als Assertion härten:
```js
const a = await createWikiNode({ port: 7801, name: 'A' })
const b = await createWikiNode({ port: 7802, name: 'B' })
await b.node.dial(a.node.getMultiaddrs()[0])
a.pages.set('test', new Y.Text('hallo'))            // Yjs-Write auf A
await waitFor(() => b.pages.get('test')?.toString() === 'hallo')  // muss auf B erscheinen
```
Zusätzlich: ein Node startet ohne Crash mit dem neuen Stack, und ein zweiter Connect
nach einem Restart prüft, dass der persistierte State + Full-State-Sync zusammenspielen.

## 8. Aufwand & Rollback

- **Aufwand:** klein bis mittel — 4 Code-Edits in einer Datei + Dependency-Bumps + ein
  Smoke-Test. Hauptaufwand ist die Laufzeit-Verifikation der Interop-Pfade.
- **Rollback:** Die bereits ausgelieferte `decodeRpcLimits`-Mitigation (aktueller `main`)
  ist ein sicherer Fallback. Die Migration läuft auf einem Branch und ist jederzeit
  verwerfbar.

## 9. Folge-Arbeit (separat, nicht Teil dieser Migration)

Die Architektur-Doku (`docs/sync-architecture.md`, „Security Considerations") hält fest:
**aktuell keine Autorisierung — jeder erreichbare Peer kann Updates pushen.** Auch nach
dem gossipsub-Fix bleibt das offen. Vor echtem Multi-User-Betrieb: die in der Doku
vorgesehene **UCAN-/DID-Autorisierung** (`packages/identity`) implementieren, sodass
eingehende CRDT-Updates **und** der Full-State-Sync gegen Berechtigungen geprüft werden,
statt blind via `Y.applyUpdate` gemergt zu werden.
