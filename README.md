# Social LLM Wiki

A decentralized, P2P wiki that serves as a shared memory for humans, groups, and LLM agents alike.
Humans and bots collaboratively curate a living knowledge base — no central server, no single owner.
Personal memory for your agent, collective memory for your group, social memory for everyone.

## Vision

- No central server — P2P via libp2p
- Bots (Agent1, Agent2) as LLM curators
- Multi-human + multi-bot collaboration
- Decentralized access control (UCAN)
- Conflict-free editing via CRDTs (Yjs)
- Bot coordination via A2A protocol

## Architecture

```
packages/
  identity/    — DIDs + UCAN
  sync/        — Yjs + libp2p GossipSub
  llm-layer/   — LLM curation (ingest/maintain)
  bot/         — A2A bot coordination
poc/
  yjs-libp2p/  — PoC: CRDT sync over GossipSub ✓
```

## Run the PoC

```bash
npm install
node poc/yjs-libp2p/src/demo.js
```

Demonstrates two nodes synchronizing Yjs documents over libp2p GossipSub — including concurrent edits with automatic CRDT resolution.

## Status

- [x] Project structure + monorepo
- [x] PoC: Yjs + libp2p GossipSub sync
- [ ] DID schema (Agent1, Agent2)
- [ ] UCAN authorization model
- [ ] A2A bot coordination
- [ ] GossipSub topic definitions
