# Eigene private LLM-Wiki — Überblick für Lukas

Du willst so eine persönliche Wissensbasis wie dein Partner sie hat. Die gute Nachricht:
im Kern ist das **ein Ordner mit Markdown-Dateien** plus ein paar Konventionen.
Alles andere — Web-Rendering, Agenten-Tools, Auto-Ingest — ist optionales Beiwerk,
das du dazuschalten kannst, wenn du es willst. Nicht verwechseln mit der
*geteilten* Social-Branch (die syncst du mit deinem Partner); deine private Wiki läuft
eigenständig, nur bei dir.

## Der Kern: ein Ordner + eine Konvention

Eine Wiki ist einfach:

```
mein-wiki/
├── SCHEMA.md          ← die Spielregeln (Seitenformat, Kategorien)
├── wiki-index.md      ← alle Seiten, ein Einzeiler je Seite
├── log.md             ← Änderungslog (neueste zuerst)
├── _sources/          ← Rohmaterial (Original-Quellen), das du ingestierst
└── pages/             ← die kuratierten Seiten
    ├── technik/
    ├── projekte/
    ├── personen/
    └── …
```

Jede Seite ist Markdown mit einem kleinen YAML-Kopf (`title`, `category`, `tags`,
`updated`) und `[[wikilinks]]` zwischen Seiten. Das war's — der Rest ist Werkzeug,
das auf diesem Ordner arbeitet. (Genau dieses Format nutzt auch die geteilte
Branch; siehe `docs/wiki-structure.md` und `docs/memory-architecture.md` im Repo.)

## Das Spektrum — such dir deine Stufe aus

### Stufe 0 — Nur der Ordner (ganz ohne Agent, ohne Server)
Leg den Ordner an, schreib Markdown-Seiten von Hand, verlink sie mit `[[…]]`.
Das ist schon eine vollwertige, durchsuchbare Wissensbasis (`grep`, jeder Editor).
**Kein LLM, kein Server, keine Cloud nötig.** Die „LLM"-Teile sind Beschleuniger,
keine Voraussetzung.

### Stufe 1 — + Web-Ansicht (Quartz)
[Quartz](https://quartz.jzhao.xyz) rendert den Ordner als hübsche, verlinkte
Website mit Graph-Ansicht und Volltextsuche — read-only, lokal. Ein kleiner
Watcher baut bei jeder Änderung neu. Optional der **Edit-Server** aus diesem Repo
(`packages/edit-server`), der einen „✎ Edit this page"-Button hinzufügt, damit du
im Browser bearbeiten kannst. Immer noch kein Agent nötig.
**Konkrete Schritt-für-Schritt-Installation:** [quickstart/QUARTZ.md](./quickstart/QUARTZ.md).

### Stufe 2 — + Claude Code mit Ordner-Zugriff  ← der einfachste „Agenten"-Weg
Das ist der Weg, den du meinst: **du gibst Claude Code einfach Zugriff auf den
Wiki-Ordner.** Starte `claude` in dem Verzeichnis (oder füg es als Arbeitsordner
hinzu). Claude liest/schreibt die `.md`-Dateien mit seinen normalen Werkzeugen
(Read/Write/Edit/Grep) — **kein MCP-Server, kein Setup.**

Der einzige Trick: leg eine `CLAUDE.md` in den Ordner, die dem Agenten die
Konventionen erklärt (Seitenformat, Kategorien, „bei neuer Seite `wiki-index.md`
und `log.md` pflegen"). Genau so funktioniert ein solches Setup — der Agent
liest die `SCHEMA.md` und arbeitet direkt auf den Dateien. Ergebnis: du sagst
„fass das zu Thema X als Wiki-Seite zusammen", und Claude legt sie regelkonform an.

### Stufe 3 — + MCP-Server (strukturierte Tools, auch für Claude Desktop)
Der MCP-Server aus diesem Repo (`packages/mcp-server`) legt sich über denselben
Ordner und bietet Tools: `wiki_read`, `wiki_search`, `wiki_list`, `wiki_write_page`,
plus `wiki_graph` / `wiki_gaps` (Wissenslücken-Analyse à la InfraNodus). Sinnvoll,
wenn du **Claude Desktop / andere MCP-Clients** nutzt oder die Graph-/Lücken-Analyse
willst. Für Claude Code allein reicht meist Stufe 2 (direkter Dateizugriff kann
schon alles lesen/schreiben) — der MCP ergänzt v. a. die strukturierte Suche und
die Graph-Tools.

Einrichtung (stdio, in deiner Claude-Code-`.mcp.json`):
```json
{ "mcpServers": { "wiki": {
    "command": "node",
    "args": ["/PFAD/social-llm-wiki/packages/mcp-server/src/index.js"],
    "env": { "WIKI_ROOT": "/PFAD/mein-wiki" } } } }
```

### Stufe 4 — + selbst-kuratierende Pipeline (Karpathy-Muster)
Die volle Ausbaustufe: ein **Vier-Schichten-Gedächtnis**
(`raw/ → inbox/ → review/ → pages/`, siehe `docs/memory-architecture.md`).
- **Auto-Ingest-Kanäle** (`packages/channels`) werfen Rohmaterial in `inbox/` —
  z. B. ein Drop-Ordner (Datei rein → wird verarbeitet), später Mail/RSS/…
- **LLM-Review** (`packages/llm-layer`) sichtet `inbox/` periodisch und schlägt
  vor, was zu einer echten Wiki-Seite promoviert wird — du entscheidest.
- **Claude-Code-Hooks** (`hooks/`) laden beim Sitzungsstart passenden Kontext und
  sichern am Ende eine Session-Notiz.
Das macht aus der Wiki ein „lebendes" Gedächtnis, das sich mit der Zeit selbst
ordnet. Alles optional und schrittweise nachrüstbar.

## Empfohlener Einstieg

1. **Stufe 0+2 zuerst:** Ordner anlegen (kopier dir `SCHEMA.md` als Vorlage aus
   diesem Repo), eine `CLAUDE.md` mit den Konventionen rein, und
   Claude Code im Ordner starten. Damit hast du sofort eine agentengestützte Wiki.
2. **Dann Quartz (Stufe 1)** dazunehmen, wenn du eine schöne Browse-/Graph-Ansicht
   willst.
3. **MCP / Pipeline (Stufe 3–4)** nur, wenn du den konkreten Mehrwert brauchst
   (Claude Desktop, Lücken-Analyse, Auto-Ingest).

## Zusammengefasst

- Die Wiki ist **zuerst ein Markdown-Ordner** — ohne Agent und ohne Server voll
  nutzbar.
- **Claude Code braucht keinen MCP-Server** — Ordner-Zugriff + eine `CLAUDE.md`
  mit den Regeln genügen; er arbeitet direkt auf den Dateien.
- Der **MCP-Server, Quartz, der Edit-Server und die Ingest-Pipeline** sind
  optionale Schichten, die du einzeln dazuschalten kannst — dasselbe Repo liefert
  alle Teile.

Diese private Wiki ist unabhängig von der geteilten Social-Branch. Wenn du später
auch mal einen Bereich davon mit jemandem teilen willst, geht das genauso wie im
geteilten Setup (P2P-Sync eines Unterordners) — aber das ist ein späterer Schritt.
