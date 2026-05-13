# Social LLM Wiki

Dezentrales, soziales Wiki — gemeinsam kuratiert durch Menschen und LLM-Agenten (Agent1, Agent2).

## Architektur

| Schicht | Technologie |
|---|---|
| Identität | DIDs (Decentralized Identifiers) |
| Auth | UCAN (User Controlled Authorization Networks) |
| Sync | Yjs/Automerge (CRDTs) + libp2p GossipSub |
| LLM-Layer | Karpathy ingest/maintain pattern |
| Bot-Koordination | A2A protocol |
| Visualisierung | Quartz (persönlich) + Outline (shared) |
| Suche | Meilisearch |
| Hardware | Raspberry Pi 5, geplant Mac Mini M5 (2026 H2) |

## Monorepo-Struktur

```
packages/
  identity/    — DIDs + UCAN Berechtigungsmodell
  sync/        — Yjs + libp2p GossipSub Sync-Layer
  llm-layer/   — LLM-Kuration (ingest/maintain pattern)
  bot/         — A2A Bot-Koordination (Agent1, Agent2)
poc/
  yjs-libp2p/  — PoC: CRDT-Sync über libp2p GossipSub
```

## Konventionen

- ESM throughout (`"type": "module"`)
- Node ≥ 22
- JS/Node primär; andere Sprachen wenn sinnvoll begründet
- Jedes Package hat eigene `package.json`

## Offene Fragen (Stand April 2026)

- Konfliktauflösung zwischen Agent1- und Agent2-Edits
- UCAN vs. einfacherer Auth-Ansatz für Phase 1
- Details A2A/libp2p-Implementierung (Klärung mit Sönke läuft)
