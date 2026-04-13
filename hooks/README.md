# Claude Code Hooks

Integration des Social LLM Wiki als Memory-Layer für Claude Code.

## Hooks

### `session-start.js` — Wiki-Kontext laden

**Event:** `SessionStart` (startup + resume)

Liest beim Session-Start die zuletzt bearbeiteten Wiki-Seiten aus
`wiki/@darius/` und injiziert sie als `additionalContext` in die Session.
Claude sieht die Wiki-Inhalte als Hintergrundwissen, ohne dass du sie
manuell einfügen musst.

Steuerung über Umgebungsvariablen:
| Variable | Default | Bedeutung |
|---|---|---|
| `WIKI_ROOT` | `…/wiki` | Pfad zum Wiki-Verzeichnis |
| `WIKI_NAMESPACE` | `@darius` | Welcher Namespace geladen wird |
| `WIKI_MAX_PAGES` | `10` | Maximal geladene Seiten |

### `session-stop.js` — Session ins Inbox speichern

**Event:** `Stop`

Legt beim Session-Ende eine Notiz in `wiki/inbox/claude-sessions/` ab —
mit Zeitstempel, Arbeitsverzeichnis und (falls verfügbar) den letzten
User-Nachrichten aus dem Transcript.

Diese Einträge sind **Kurzzeitgedächtnis** (TTL 30d). Kai kann sie im
LLM-Review-Schritt zu Wiki-Seiten promoten, falls sie relevant sind.

### `post-wiki-edit.js` — Maintenance-Trigger bei Wiki-Änderungen

**Event:** `PostToolUse` auf `Write` / `Edit`

Wenn Claude eine Datei innerhalb von `wiki/` bearbeitet, wird ein
Trigger-Eintrag in `wiki/inbox/triggers/` angelegt. Kai liest diese
Trigger periodisch und kuratiert betroffene Seiten nach.

---

## Installation

1. `hooks/settings-example.json` öffnen
2. Den `"hooks"` Block in `~/.claude/settings.json` einfügen
   (Pfade ggf. anpassen)
3. Fertig — gilt für alle Claude Code Sessions

```bash
# Schnellstart: settings.json direkt bearbeiten
code ~/.claude/settings.json
```

---

## Datenfluss

```
Session startet
    │
    ▼
session-start.js
    │  liest wiki/@darius/ (letzte N Seiten)
    ▼
additionalContext → Claude sieht Wiki-Inhalt

    … Session läuft …

Claude schreibt wiki/
    │
    ▼
post-wiki-edit.js → inbox/triggers/

Session endet
    │
    ▼
session-stop.js → inbox/claude-sessions/YYYY-MM-DD-session.md

    … später …

Kai (LLM-Review) liest inbox/ → schlägt Promotionen vor
Nutzer entscheidet → wiki/ (Langzeitgedächtnis)
```
