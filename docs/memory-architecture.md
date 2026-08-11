# Memory Architecture

How the wiki works as the persistent memory of an LLM agent — what gets kept, what
fades, and who decides.

**Stand: 2026-08-11.** For the system as a whole see [konzept.md](konzept.md); for the
folder layout and conventions, [wiki-structure.md](wiki-structure.md).

---

## Core Idea

The wiki is not a knowledge base the agent occasionally consults — it is where the
agent's long-term memory lives. Everything that should outlast a conversation goes
there, as plain Markdown on disk. No central API, no shared database: files, plus P2P
sync for the parts that are shared.

The agent (Kai, running in NanoClaw) has the wiki mounted and reads and writes it
directly. It has **no MCP access** — the MCP server exists for the *other* clients
(Claude Code sessions on other machines, and the collaborator's setup).

---

## Layers

```
_sources/    what was actually read     — immutable after ingest, permanent
inbox/       short-term memory          — captured, not yet curated
pages/       long-term memory           — curated, linked, permanent
```

### `_sources/` — what was read

The raw material behind a page: an article, a conversation excerpt, a file. Written
once at ingest and never edited afterwards, named `YYYY-MM-DD-<slug>.md` with a
frontmatter block recording where it came from.

Its purpose is not storage but **audit**: a page can claim anything, and `_sources/`
is how you check what it was actually built from. It also makes reprocessing possible
when a better model comes along. Currently around 200 files.

The weekly lint flags source files no page references, and pages referencing sources
that do not exist.

### `inbox/` — captured, not yet curated

Notes that arrived but have not been folded into a page. Each entry carries
frontmatter with its channel, author, ingest timestamp, and `promoted: false`.

```
inbox/
  notes/       free notes, typically from external Claude Code sessions
  projekte/    project notes
  sessions/    session captures
  lint/        the weekly lint reports
```

Entries declare `ttl: 30d`. **Nothing enforces it** — the oldest entry currently in
the inbox is three months old. Treat the field as documentation of intent, not as a
mechanism: the inbox grows until something is promoted or deleted by hand.

Promotion is not a separate directory. The agent folds a worthwhile entry into the
matching page under `pages/`, copies the raw content to `_sources/`, and sets
`promoted: true` on the inbox file rather than deleting it, so the record of what was
processed survives.

### `pages/` — long-term memory

Curated, interlinked, permanent. This is what `wiki query` searches, what Quartz
renders, and what the graph analysis runs on.

---

## Flow

```
external source
      │
      ▼
  inbox/          normalized Markdown + frontmatter, promoted: false
      │
      │  agent curates — on demand, or prompted by a lint drop
      ▼
  _sources/       the raw material, kept verbatim
      │
      ▼
  pages/          curated page, linked into the graph
      │
      ▼
  wiki-index.md + log.md updated
```

There is **no staging or approval step**. An earlier design had a `review/` layer where
the agent drafted candidates and the user approved each one; it was never built. In
practice the agent writes directly and the weekly lint is the review — after the fact,
over the whole wiki, rather than per page.

That trade is deliberate: per-page approval is a queue that grows faster than anyone
drains it. It does mean the agent can write something wrong into long-term memory, and
that the lint drop is worth actually reading.

---

## How Material Arrives

| Route | What it is |
|---|---|
| Conversation | The agent ingests a fact worth keeping from a chat |
| External Claude Code sessions | Write to `inbox/` over the MCP server |
| Email | Reaches the agent as a file; ingested if relevant |
| Web research | Fetched, summarized, ingested with the URL as source |

The MCP route is the one with a trap: an MCP server started without `WIKI_ROOT`
defaults to this repo's `wiki/` directory, which nothing else reads. Months of notes
once went there unnoticed. Set `WIKI_ROOT`, and set `WIKI_AUTHOR` while you are at it —
otherwise entries are signed as somebody else.

Large documents — papers, long PDFs — are deliberately **not** ingested wholesale.
They inflate pages and context to no benefit; a summary plus a link is the rule, with
the full text staying outside.

---

## Curation Loop

Two operations, after the Karpathy pattern:

- **ingest** — raw material becomes a new page, or a dated section appended to an
  existing one. The agent decides which; pages are cumulative, never overwritten.
- **maintain** — the weekly lint (Sundays 09:00) reports broken links, filename
  collisions, index drift, stale pages, and consolidation candidates. The agent reads
  the drop and proposes concrete fixes rather than a general tidy-up.

`wiki query "<topic>"` is the read path: consult the index, grep the pages, summarize.
The agent is instructed to run it before answering "I don't know" about anything not
already in the conversation — the failure mode being an agent that has the fact on disk
and does not look.

---

## What Is Shared

Only `pages/social/<group>/` synchronizes to peers. `_sources/`, `inbox/`, and the
private categories stay on the machine.

This is a real boundary, not a convention: the sync node is scoped to `pages/social/`,
each group is its own namespace with its own peer set, and a publish gate withholds any
shared page that names a private one. See [sync-architecture.md](sync-architecture.md).

---

## Memory Outside the Wiki

The agent also keeps `memory/` files in NanoClaw (daily logs, people, projects,
learnings) and Claude Code keeps its own per-project memory. These are separate stores
with different lifetimes, and they are **not** synchronized with the wiki.

The rough division: `memory/` holds what the agent needs to be itself and to work with
its user — preferences, relationships, ongoing context. The wiki holds knowledge that
would still be worth having if written by someone else. Facts drift between the two,
and a fact that has settled belongs in the wiki.

---

## Open Points

- **The inbox has no expiry.** Either implement the declared TTL or drop the field.
- **Promotion is unmeasured.** Nothing reports how many entries sit unpromoted or how
  old they get; the lint could.
- **No sync visibility.** After writing a shared page there is no answer to "did it
  reach the other side" — see the open points in [konzept.md](konzept.md).
