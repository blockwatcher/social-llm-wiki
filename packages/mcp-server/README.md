# Social LLM Wiki — MCP Server

Ein [Model Context Protocol (MCP)](https://modelcontextprotocol.io) Server,
der das Social LLM Wiki als Tools für KI-Assistenten bereitstellt.

Im Gegensatz zu den [Claude Code Hooks](../../hooks/README.md), die nur im
Claude Code CLI funktionieren, läuft dieser MCP Server mit **jedem MCP-kompatiblen Client**:

| Client | Unterstützt |
|---|---|
| Claude Code CLI | ✓ |
| Claude Desktop / Cowork | ✓ |
| Cursor | ✓ |
| Continue (VS Code) | ✓ |
| Eigene Agenten via MCP SDK | ✓ |

---

## Was ist MCP?

Das Model Context Protocol ist ein offener Standard von Anthropic, der definiert
wie KI-Modelle mit externen Tools und Datenquellen kommunizieren.
Ein MCP Server läuft als lokaler Prozess und kommuniziert über stdio mit dem Client.
Der Client (z.B. Claude Desktop) ruft die Tools des Servers auf — ähnlich wie
Function Calling, aber standardisiert und über Prozessgrenzen hinweg.

```
Claude Desktop / Cowork
        │
        │  MCP (stdio)
        ▼
  wiki-mcp-server
        │
        ▼
  wiki/ Dateisystem
```

---

## Verfügbare Tools

### `wiki_list` — Seiten auflisten

Zeigt alle Seiten eines Namespace als Dateibaum mit Titeln.
Nützlich um zu erkunden was im Wiki vorhanden ist.

**Parameter:**

| Name | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `namespace` | string | nein | z.B. `@darius`, `@soenke`, `groups/hiking`. Leer = alle. |
| `subpath` | string | nein | Unterordner, z.B. `reisen` oder `notizen`. |

**Beispiel-Aufruf:**
```
wiki_list(namespace="@darius", subpath="reisen")
```

**Beispiel-Ausgabe:**
```
## Wiki — @darius/reisen
_2 Seite(n)_

- **zugspitze-2026.md** — Zugspitze via Höllental
- **frankreich-2025.md** — Frankreich Roadtrip 2025
```

---

### `wiki_read` — Seite lesen

Liest eine einzelne Wiki-Seite und gibt den vollständigen Markdown-Inhalt zurück.

**Parameter:**

| Name | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `path` | string | ja | Relativer Pfad ab Wiki-Root, z.B. `@darius/notizen/social-llm-wiki.md` |

**Beispiel-Aufruf:**
```
wiki_read(path="@darius/notizen/social-llm-wiki.md")
```

**Beispiel-Ausgabe:**
```markdown
---
title: Social LLM Wiki Projekt
tags: [projekt, p2p, llm]
updated: 2026-04-13
---

# Social LLM Wiki

Dezentrales Wiki mit Yjs CRDTs + libp2p GossipSub.
PoC läuft. Nächste Schritte: DID-Schema, Email-Ingest-Channel.
```

---

### `wiki_search` — Wiki durchsuchen

Durchsucht alle Markdown-Seiten nach einem Stichwort oder einer Phrase.
Gibt Treffer mit Kontext-Ausschnitten zurück, sortiert nach Trefferanzahl.

**Parameter:**

| Name | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `query` | string | ja | Suchbegriff oder Phrase, z.B. `libp2p` oder `Zugspitze` |
| `namespace` | string | nein | Suche einschränken, z.B. `@darius`. Leer = Wiki-weit. |

**Beispiel-Aufruf:**
```
wiki_search(query="libp2p", namespace="@darius")
```

**Beispiel-Ausgabe:**
```
## Suchergebnisse für „libp2p" (@darius)
_2 Treffer_

### notizen/social-llm-wiki.md _(3×)_
> …Dezentrales Wiki mit Yjs CRDTs + libp2p GossipSub. PoC läuft…

### projekte/poc-notes.md _(1×)_
> …libp2p Node startet auf Port 7801, verbindet sich mit Node B…
```

---

### `wiki_write_inbox` — Ins Kurzzeitgedächtnis schreiben

Speichert einen neuen Eintrag in `wiki/inbox/<channel>/`.
Dies ist der korrekte Weg wie Claude Informationen festhalten soll —
**niemals direkt in `wiki/` schreiben**, immer über `inbox/`.

Der LLM-Review-Schritt (Kai) entscheidet später ob der Eintrag ins
Langzeitgedächtnis (`wiki/`) promoten wird.

**Parameter:**

| Name | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `content` | string | ja | Inhalt der Notiz (Markdown) |
| `title` | string | nein | Titel der Notiz |
| `channel` | string | nein | Kategorie: `notes`, `tasks`, `research`, ... Default: `notes` |
| `tags` | string[] | nein | Tags, z.B. `["projekt", "libp2p"]` |
| `namespace` | string | nein | Autor-Namespace, z.B. `@darius`. Default: `@darius` |

**Beispiel-Aufruf:**
```
wiki_write_inbox(
  title="Idee: Email-Ingest-Channel",
  content="IMAP-Polling auf bestimmte Absender einschränken...",
  channel="research",
  tags=["email", "ingest", "auto"]
)
```

**Erstellt:** `wiki/inbox/research/2026-04-13-16-30-00-idee-email-ingest-channel.md`

```markdown
---
channel: research
schema: text/note
author: @darius
ingested: 2026-04-13T16:30:00Z
title: Idee: Email-Ingest-Channel
tags: ["email", "ingest", "auto"]
ttl: 30d
promoted: false
---

# Idee: Email-Ingest-Channel

IMAP-Polling auf bestimmte Absender einschränken...
```

---

## Installation

### Schritt 1 — Abhängigkeiten installieren

```bash
cd /home/darius/social-llm-wiki
npm install
```

### Schritt 2 — MCP Server in Claude Code registrieren

In `~/.claude/settings.json` den Block `"mcpServers"` hinzufügen:

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/home/darius/social-llm-wiki/packages/mcp-server/src/index.js"],
      "env": {
        "WIKI_ROOT": "/home/darius/social-llm-wiki/wiki"
      }
    }
  }
}
```

### Schritt 3 — MCP Server in Claude Desktop (Cowork) registrieren

Konfigurationsdatei öffnen:

| OS | Pfad |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Denselben Block einfügen:

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/home/darius/social-llm-wiki/packages/mcp-server/src/index.js"],
      "env": {
        "WIKI_ROOT": "/home/darius/social-llm-wiki/wiki"
      }
    }
  }
}
```

**Wichtig:** Claude Desktop muss nach der Konfigurationsänderung neu gestartet werden.
Der MCP Server erscheint dann in der Tool-Liste als `wiki`.

### Schritt 4 — Verifikation

In Claude Code:
```
/mcp
```
Zeigt alle verbundenen MCP Server. `wiki` sollte mit 4 Tools erscheinen.

In Claude Desktop: Das Hammer-Icon in der Eingabeleiste zeigt verfügbare Tools —
dort sollten `wiki_list`, `wiki_read`, `wiki_search`, `wiki_write_inbox` erscheinen.

---

## Manuell testen

```bash
cd /home/darius/social-llm-wiki

# Tools auflisten
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | WIKI_ROOT=./wiki node packages/mcp-server/src/index.js 2>/dev/null | jq .

# wiki_list aufrufen
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"wiki_list","arguments":{"namespace":"@darius"}}}' \
  | WIKI_ROOT=./wiki node packages/mcp-server/src/index.js 2>/dev/null | jq .

# wiki_search aufrufen
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"wiki_search","arguments":{"query":"libp2p"}}}' \
  | WIKI_ROOT=./wiki node packages/mcp-server/src/index.js 2>/dev/null | jq .
```

### MCP Inspector (visuelles Debugging)

```bash
npm run inspect --workspace=@social-llm-wiki/mcp-server
```

Öffnet eine Web-UI unter `http://localhost:5173` mit der alle Tools interaktiv
getestet werden können.

---

## Hooks vs. MCP Server — Wann was nutzen?

| | Hooks | MCP Server |
|---|---|---|
| **Funktioniert in** | Claude Code CLI only | Claude Code + Claude Desktop + Cowork + andere |
| **Kontext-Injection** | Automatisch beim Session-Start | Claude ruft Tools bei Bedarf aktiv auf |
| **Kontrolle** | Läuft immer, nicht abschaltbar pro Session | Claude entscheidet wann es sinnvoll ist |
| **Inbox schreiben** | Automatisch beim Session-Ende | Gezielt per `wiki_write_inbox` |
| **Empfehlung** | Basis-Kontext vorladen + Session-Log | Gezieltes Lesen/Suchen/Schreiben |

**Optimale Kombination:** Hooks laden beim Start einen kompakten Kontext-Snapshot,
der MCP Server wird für gezielte Abfragen und das Schreiben in die Inbox genutzt.

---

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|---|---|---|
| `WIKI_ROOT` | `/home/darius/social-llm-wiki/wiki` | Absoluter Pfad zum Wiki-Verzeichnis |

---

## Geplante Erweiterungen

- `wiki_promote` — Inbox-Eintrag nach Benutzer-Freigabe in `wiki/` promoten
- `wiki_write_page` — Direkt eine Wiki-Seite anlegen/aktualisieren (nur für Kai/Horst Duda)
- `wiki_recent` — Zuletzt geänderte Seiten abrufen
- Namespace-Filter für alle Tools
- Volltextsuche mit Meilisearch (wenn verfügbar)
