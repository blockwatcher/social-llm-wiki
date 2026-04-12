# Social LLM Wiki

Dezentrales, soziales Wiki für Menschen + LLM-Agenten — gemeinsam kuratiert ohne zentralen Server.

## Vision

- Kein zentraler Server — P2P via libp2p
- Bots (Agent1, Agent2) als LLM-Kuratoren
- Multi-Mensch + Multi-Bot kollaborativ
- Dezentrale Rechteverwaltung (UCAN)
- Konfliktfreies Editieren via CRDTs (Yjs)
- Bot-Koordination via A2A-Protokoll

## Architektur

```
packages/
  identity/    — DIDs + UCAN
  sync/        — Yjs + libp2p GossipSub
  llm-layer/   — LLM-Kuration (ingest/maintain)
  bot/         — A2A Bot-Koordination
poc/
  yjs-libp2p/  — PoC: CRDT-Sync über GossipSub ✓
```

## PoC ausführen

```bash
npm install
node poc/yjs-libp2p/src/demo.js
```

Zeigt zwei Nodes, die Yjs-Dokumente über libp2p GossipSub synchronisieren — inklusive concurrent edits mit automatischer CRDT-Auflösung.

## Status

- [x] Projektstruktur + Monorepo
- [x] PoC: Yjs + libp2p GossipSub Sync
- [ ] DID-Schema (Agent1, Agent2, ...)
- [ ] UCAN-Berechtigungsmodell
- [ ] A2A Bot-Koordination
- [ ] GossipSub-Topics definieren
