# Wiki Folder Structure

Where things go, and the conventions that keep the wiki navigable for both a human
and the agent curating it.

The authoritative page format lives in the wiki itself, at `SCHEMA.md` — it is what
the agent reads before every ingest. This document explains the layout and the rules
that are easy to get wrong. For the system as a whole, see [konzept.md](konzept.md).

**Stand: 2026-08-11.**

---

## Layout

```
wiki/
  SCHEMA.md            page format + ingest rules (authoritative)
  wiki-index.md        every page, one line each
  log.md               change log, newest first
  _sources/            raw ingested material — immutable after ingest
  inbox/               short-term memory, not yet curated
    lint/  notes/  projekte/  sessions/
  pages/               curated pages
    bildung/  daten/  personen/  projekte/  reisen/
    technik/  urlaub/  wissen/
    social/            shared areas, one folder per group
      darius-lukas/
```

There are **no per-person namespaces**. One person owns this wiki; the shared parts
live under `pages/social/<group>/`, and each group is its own sync namespace.

Only `pages/social/` is synchronized to peers. `_sources/`, `inbox/`, and the private
categories under `pages/` never leave the machine.

---

## Categories

`pages/<category>/` groups by subject, not by type:

| Category | What goes there |
|---|---|
| `technik/` | Technology concepts, tools, research areas |
| `wissen/` | General knowledge that is not a project or a tool |
| `projekte/` | Software projects, experiments, builds |
| `personen/` | People and the context around them |
| `reisen/` | Trips, day trips, conferences |
| `urlaub/` | Holidays, destinations, travel profile |
| `bildung/` | Education, courses, universities |
| `daten/` | Curated data collections — not projects |
| `social/` | Shared areas, one subfolder per group |

The set is not sacred, but adding a category means the agent has to learn when to use
it. Prefer an existing one unless a topic genuinely has nowhere to go.

---

## Naming

**Filenames must be unique across the whole wiki.** `wiki-index.md` and `wiki-lint.py`
address pages by filename stem, not by path. Two pages named `uebersicht.md` in
different folders collide, and one silently drops out of the index — this has happened.

Prefix instead of nesting the ambiguity away: `laermzentrale-uebersicht.md`, not
`laermzentrale/uebersicht.md`. `wiki_write_page` rejects a slug already taken and
suggests a more specific one; the weekly lint reports collisions that got in another way.

Slugs are lowercase, digits and hyphens. Dates are ISO 8601. Tags are lowercase and
hyphenated (`machine-learning`, `raspberry-pi`).

---

## Frontmatter

Every page carries frontmatter. The exact template is in `SCHEMA.md`; the parts that
break things when done wrong:

**Quote anything with YAML-reserved characters.** A value starting with `@`, or
containing `:`, em-dashes, or brackets, must be double-quoted. An unquoted
`author: @darius` once blocked the Quartz rebuild for days, and the error message
pointed at the wrong line.

```yaml
---
title: "Lärmzentrale — Immissionsschutz"   # em-dash → quoted
author: "@darius"                          # leading @ → quoted
category: technik
tags: [akustik, iso-9613]
updated: 2026-08-11
---
```

Pages in a shared group additionally carry `category: social`, `group: "<group>"`, and
a `contributors` list that accumulates everyone who has edited the page.

---

## Wikilinks

`[[Page Name]]` is a link, and links are what the graph analysis runs on. The target
must match a filename without `.md`, or a title that slugifies to one.

Two rules with teeth:

- **Link deliberately.** Wikilinks are the edges of the knowledge graph. Gap analysis
  is only as useful as the linking is honest — a page linked to nothing is invisible to it.
- **Never link from a shared page to a private one.** The shared page reaches every peer
  of its group, where such a link both dangles and discloses the private page's name.
  Name the page in plain text instead. This is enforced in three places; see
  [konzept.md](konzept.md).

---

## The Graph Tools

Two MCP tools read the link structure rather than the text:

- **`wiki_graph`** — page count, link count, clusters, orphans, bridge pages.
- **`wiki_gaps`** — clusters that are *not* connected to each other, each with a
  research prompt, plus orphans, dangling links, and structural lint issues.

The idea behind `wiki_gaps` (the InfraNodus approach) is that the interesting questions
live between clusters, not inside them. Two well-developed areas with no link between
them are either genuinely unrelated or an unasked question.

These are analysis tools, not a folder structure — there is no `gaps/` or `output/`
directory. What comes out of them lands in ordinary pages, or in the weekly lint drop.

---

## The Weekly Lint

`wiki-lint.py` runs Sundays at 09:00 and drops a report the agent reads and turns into
concrete suggestions. It checks, among other things:

- broken wikilinks and missing `_sources/` references
- filename collisions
- private links inside shared groups
- drift between `wiki-index.md` and the actual pages
- slug/title mismatches, orphaned and weakly-linked pages, stale pages
- consolidation candidates — pages that are topically close but never cross-linked

The consolidation candidates are the part worth acting on: they are where the wiki is
accumulating knowledge without connecting it.
