# Memory Architecture

How the Social LLM Wiki acts as shared memory across humans, groups, and LLM agents.

---

## Core Idea

The wiki is not just a knowledge base — it is the persistent memory layer for all agents and humans
in the network. Every system that reads or writes knowledge (Claude Code, nanoclaw, clowbot, ...)
does so through a common interface: local files, synchronized via libp2p.

```
Claude Code (CLI)     reads  CLAUDE.md + wiki pages (context injection)
nanoclaw / Kai        reads + writes wiki/ (personal memory)
clowbot / Horst Duda  reads + writes wiki/ (via libp2p sync)
other future systems  same interface — files + libp2p
```

No central API. No shared database. Just files and sync.

---

## Memory Layers

Inspired by human cognitive memory models.

```
raw/            Sensory buffer      — original sources, permanent, LLM never reads directly
inbox/          Short-term memory   — normalized, auto-ingested, time-limited (30d TTL)
review/         Working memory      — LLM proposals, awaiting user decision
wiki/           Long-term memory    — curated, linked, permanent
```

### Sensory Buffer: `raw/`

- Stores original, unprocessed sources exactly as received
- **Never read directly by LLM** — only the normalized `inbox/` entry is used
- Permanent storage for text and geo sources; media stored as hash references only
- Enables re-processing with future (better) LLM models
- Provides audit trail: what did Kai actually read?
- Enables recovery from inconsistencies in `wiki/`

```
raw/
  text/           emails, notes, web clips, feeds, transcripts  → permanent
  geo/            GPX / FIT tracks                              → permanent
  media/          photos, audio                                 → hash reference only
    2026-04-12-zugspitze.ref   ← contains path + SHA256, not the blob itself
```

**Storage rationale:** Text and geo sources stay small over years (a year of emails ≈ a few MB).
Media blobs are kept in an external store (Nextcloud, local drive) referenced by an immutable hash.
For Phase 1 on RPi 5: store everything inline — migrate media externally only when storage pressure is real.

### Short-Term Memory: `inbox/`

- Auto-ingested from all channels (email, Matrix, GPS, feeds, ...)
- Minimal processing: structure only, no summarization
- Each entry: frontmatter with metadata + raw content
- **TTL: 30 days** — entries are deleted automatically regardless of promotion
- Nothing is lost: what matters gets promoted, the rest fades

```
inbox/
  emails/
    2026-04-13-soenke-libp2p-frage.md
    2026-04-13-newsletter-rustlang.md
  matrix/
    2026-04-13-kai-notiz.md
  geo/
    2026-04-12-zugspitze-track.md
  feeds/
    2026-04-13-hackernews-crdt.md
  files/
    2026-04-10-meeting-notes.md
```

### Staging: `review/`

- Populated periodically by the LLM (Kai / Horst Duda)
- LLM reads inbox, groups by topic, drafts candidate wiki pages
- User receives a notification (e.g. via Matrix):
  > *"4 new candidates this week: Zugspitze hike, Meeting with Sönke,
  > libp2p article, Pasta recipe. What should go into the wiki?"*
- User approves / rejects / edits each candidate
- Approved candidates are moved to `wiki/`, rejected ones are discarded

```
review/
  candidates/
    2026-04-13-zugspitze-hike.md      ← drafted by Kai, awaiting approval
    2026-04-13-libp2p-notes.md
```

### Long-Term Memory: `wiki/`

- Fully curated, summarized, interlinked
- Written only after user approval (or explicit bot action in shared namespaces)
- Organized by namespace (see below)
- Permanent — no TTL

---

## Memory Flow

```
External Source
      │
      ▼
  Channel               (email-imap, matrix-watch, gps-track, ...)
      │
      ├──► raw/         original blob stored permanently (text/geo)
      │                 or hash reference written (media)
      │
      ▼
  inbox/                normalized Markdown + frontmatter, 30d TTL
      │
      │  periodic trigger (daily / on demand)
      ▼
  LLM Review            Kai reads inbox, groups topics,
      │                 drafts candidate pages in review/
      │
      ▼
  User Supervision      notification via Matrix or CLI
      │                 approve / reject / edit
      │
      ▼
  wiki/                 curated, linked, permanent
```

---

## Auto-Ingest Channels

Each channel ingests from a source into `inbox/` with minimal processing.
Heavy curation is deferred to the LLM review step.

| Channel         | Source                  | inbox/ path                        |
|-----------------|-------------------------|------------------------------------|
| `email-imap`    | IMAP mailbox            | `emails/YYYY-MM-DD-subject.md`     |
| `matrix-watch`  | Matrix rooms            | `matrix/YYYY-MM-DD-room.md`        |
| `rss-feed`      | RSS / Atom feeds        | `feeds/YYYY-MM-DD-title.md`        |
| `file-watch`    | Watched folder (drop)   | `files/YYYY-MM-DD-name.md`         |
| `calendar-ical` | iCal / CalDAV           | `events/YYYY-MM-DD-event.md`       |
| `geo-track`     | Garmin / phone GPS      | `geo/YYYY-MM-DD-track.md`          |
| `voice-memo`    | Audio → transcription   | `voice/YYYY-MM-DD-memo.md`         |
| `web-clip`      | URL / browser extension | `clips/YYYY-MM-DD-title.md`        |

All entries share a common frontmatter schema:

```yaml
---
channel: email-imap
schema: text/email
author: did:key:z...
namespace: "@darius"
ingested: 2026-04-13T08:14:00Z
tags: []
ttl: 30d
promoted: false
---
```

### Email Auto-Ingest

IMAP polling with configurable filters:
- Filter by sender, subject keywords, labels/folders
- Body + subject → Markdown
- Attachments stored as references (not embedded)
- Newsletters and automated mail can be filtered out or given lower priority

---

## Integration with Existing Systems

### Claude Code (CLI)

Claude Code reads `CLAUDE.md` as project context. This can be extended to
automatically inject relevant wiki pages:

- A pre-session hook reads `wiki/@darius/` and injects a summary
- Or: a `wiki context <topic>` command pulls specific pages into context
- The existing Claude Code memory system (`~/.claude/projects/.../memory/`)
  can be backed by the wiki — memories written there sync into `wiki/@darius/`

### nanoclaw / Kai

nanoclaw already has `memory/wiki/` as a local Quartz wiki — this is the PoC.
Next steps:
- Kai actively writes to `wiki/` (not just reads)
- Kai runs the LLM review step periodically
- Kai sends review notifications via Matrix

### clowbot / Horst Duda

Same architecture as Kai, but in Sönke's namespace.
Shared namespaces (`groups/`) are synced between both nodes via libp2p GossipSub.
Coordination between Kai and Horst Duda happens via A2A protocol.

---

## Namespace Model

```
wiki/
  @darius/          Personal long-term memory (Darius + Kai)
    reisen/
    notizen/
    projekte/
  @soenke/          Personal long-term memory (Sönke + Horst Duda)
    ...
  groups/
    hiking/         Shared — both can read and write
    projekte/       Shared — collaborative projects
    ...

raw/                Sensory buffer — personal only, never synced, permanent
inbox/              Short-term — personal only, never synced to peers
review/             Staging — personal only, user-supervised
```

`raw/`, `inbox/`, and `review/` are **never synced** — they are strictly personal.
Only promoted content in `wiki/` participates in P2P sync.

---

## Open Questions

- **Review trigger**: periodic (daily cron) vs. event-driven (inbox reaches N entries)?
- **Notification channel**: Matrix message for review requests, or a small local web UI?
- **Email filter rules**: where are they configured — per-user config file or via bot conversation?
- **Shared inbox**: should groups have a shared inbox, or do individuals promote to shared namespaces?
- **Voice memos**: transcription local (Whisper on RPi 5) or via API?
