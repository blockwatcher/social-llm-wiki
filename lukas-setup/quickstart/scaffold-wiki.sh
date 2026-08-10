#!/usr/bin/env bash
# Scaffold a fresh personal LLM-wiki: folder structure + SCHEMA + a CLAUDE.md
# that teaches Claude Code the conventions. Generic template — no private data.
#
# Usage:  bash scaffold-wiki.sh [ZIEL-ORDNER]   (default: ~/mein-wiki)
set -euo pipefail

TARGET="${1:-$HOME/mein-wiki}"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "Abbruch: '$TARGET' existiert und ist nicht leer. Anderen Ordner wählen." >&2
  exit 1
fi

mkdir -p "$TARGET"/_sources
mkdir -p "$TARGET"/pages/{projekte,technik,personen,bildung,daten,reisen,urlaub}
TODAY="$(date +%Y-%m-%d)"

# ── SCHEMA.md ────────────────────────────────────────────────────────────────
cat > "$TARGET/SCHEMA.md" <<'EOF'
# Wiki Schema

Persönliche Wissensbasis in drei Schichten: Rohquellen (`_sources/`),
kuratierte Seiten (`pages/`) und diese Regeln.

## Directory Layout

```
wiki/
├── SCHEMA.md        ← diese Datei (Regeln)
├── CLAUDE.md        ← Anweisungen für Claude Code
├── wiki-index.md    ← alle Seiten, ein Einzeiler je Seite
├── log.md           ← Änderungslog (neueste zuerst)
├── _sources/        ← Rohmaterial (nach Ingest read-only): YYYY-MM-DD-slug.md
└── pages/           ← kuratierte Seiten
    ├── projekte/    ← Software-Projekte, Experimente, Builds
    ├── technik/     ← Technik-Konzepte, Tools, Recherchethemen
    ├── personen/    ← Menschen, Beziehungen, Kontext
    ├── bildung/     ← Kurse, Lernthemen
    ├── daten/       ← (halb-)automatische Daten-Sammlungen
    ├── reisen/      ← Ausflüge, Orte, Events
    └── urlaub/      ← Urlaube, Reiseziele
```
Kategorien nach Bedarf anpassen — es sind nur Ordner.

## Page Format

```markdown
---
title: "<Titel>"
category: <projekte|technik|personen|bildung|daten|reisen|urlaub>
tags: [tag1, tag2]
sources: [_sources/YYYY-MM-DD-slug.md]
updated: YYYY-MM-DD
---

# Titel

Ein-Satz-Zusammenfassung.

## Kontext
Hintergrund und Motivation.

## Details
Kernfakten, strukturierter Inhalt.

## Verbindungen
- [[andere-seite]] — warum verwandt

## Offene Fragen
- ...
```

## Regeln (wichtig)

- **YAML-Frontmatter quoten:** Werte mit Sonderzeichen (`:`, `@`, `#`, em-dash `—`,
  Klammern …) in **Doppel-Quotes** — sonst bricht der YAML-Parser (und ein späterer
  Quartz-Build zeigt 404). `title: "Foo: Bar"`, `author: "@name"`.
- **Eindeutige Dateinamen:** Slugs/Dateinamen wikiweit eindeutig halten — nicht
  zweimal `uebersicht.md` in verschiedenen Ordnern (Tools indexieren oft nach
  Dateiname-Stamm, nicht nach Pfad). Lieber `thema-uebersicht.md`.
- **Wikilinks** `[[slug]]` — der Name muss dem Dateinamen ohne `.md` entsprechen.
- **Tags** klein und mit Bindestrich: `machine-learning`, `raspberry-pi`.
- **Daten** immer ISO 8601 (`YYYY-MM-DD`).
- **Seiten sind kumulativ:** neue Fakten unter `## YYYY-MM-DD Update` anhängen,
  bestehende Abschnitte nicht löschen.
- **Ein Source-File pro Ingest-Event** — bestehende `_sources/`-Dateien nie
  überschreiben.

## wiki-index.md — eine Zeile je Seite
`- [[slug]] — Ein-Satz-Beschreibung (kategorie, updated: YYYY-MM-DD)`

## log.md — neueste zuerst
```
## YYYY-MM-DD — <Aktion>
- <was sich änderte und warum>
```
EOF

# ── CLAUDE.md ────────────────────────────────────────────────────────────────
cat > "$TARGET/CLAUDE.md" <<'EOF'
# Diese Wiki pflegen

Dieser Ordner ist eine persönliche Wissensbasis aus Markdown-Seiten. **Lies zuerst
`SCHEMA.md`** — es definiert Ordnerstruktur, Seitenformat und die Regeln. Halte
dich strikt daran.

## Wenn ich dich etwas frage

Bevor du zu einem Thema mit „weiß ich nicht" antwortest, das nicht aus dem
laufenden Gespräch stammt: **durchsuche zuerst die Wiki.**
1. `wiki-index.md` lesen (Kandidaten-Seiten).
2. `grep -ri "<thema>" pages/` für Treffer.
3. Passende Seiten lesen und die relevanten Fakten zusammenfassen — mit
   Quellenangabe („Laut `pages/technik/xyz.md` …"), damit klar ist, dass es
   Recall ist und kein Live-Wissen.
Findet die Suche nichts, sag das explizit („in der Wiki finde ich nichts zu X").

## Wenn wir etwas Merkenswertes erarbeiten

Leg eine Seite an oder erweitere eine bestehende — **nach dem Page Format in
`SCHEMA.md`**:
1. Optional das Rohmaterial nach `_sources/YYYY-MM-DD-<slug>.md` sichern.
2. Richtige `pages/<kategorie>/`-Datei bestimmen. Existiert die Seite: neue Fakten
   unter `## YYYY-MM-DD Update` anhängen. Sonst: neu anlegen.
3. `wiki-index.md` aktualisieren (Zeile hinzufügen/ändern).
4. `log.md` ergänzen (neuester Eintrag oben).

## Nicht vergessen (häufige Fehler)

- **YAML quoten** — Titel/Werte mit `:` `@` `—` `(` … in Doppel-Quotes, sonst
  bricht das Rendern.
- **Eindeutige Dateinamen** — keine zwei gleichnamigen `.md` in verschiedenen
  Ordnern.
- **Wikilink = Dateiname ohne `.md`**.
- **Daten in ISO 8601**, Tags klein-mit-bindestrich.
- **Nichts Vertrauliches** ungefragt in die Wiki schreiben (Passwörter, Tokens,
  sensible Daten Dritter). Im Zweifel nachfragen.

## Stil
Knapp und strukturiert. Seiten sind zum späteren Nachschlagen — Fakten vor Prosa.
EOF

# ── wiki-index.md ────────────────────────────────────────────────────────────
cat > "$TARGET/wiki-index.md" <<EOF
# Wiki Index

Alle Seiten, ein Einzeiler je Seite.

- [[beispiel-seite]] — Vorlagen-/Beispielseite; löschen, sobald du deine erste echte Seite hast (technik, updated: $TODAY)
EOF

# ── log.md ───────────────────────────────────────────────────────────────────
cat > "$TARGET/log.md" <<EOF
# Änderungslog

Neueste zuerst.

## $TODAY — Wiki initialisiert
- Grundgerüst per scaffold-wiki.sh angelegt (SCHEMA, CLAUDE.md, Kategorien, Beispielseite).
EOF

# ── Beispielseite ────────────────────────────────────────────────────────────
cat > "$TARGET/pages/technik/beispiel-seite.md" <<EOF
---
title: "Beispielseite"
category: technik
tags: [beispiel, vorlage]
updated: $TODAY
---

# Beispielseite

So sieht eine Wiki-Seite aus — kopier das Format und lösch diese Seite, sobald du deine erste echte hast.

## Kontext
Kurz: worum geht es und warum ist es notiert.

## Details
Die eigentlichen Fakten, strukturiert. Verlinke Verwandtes mit \`[[slug]]\`.

## Verbindungen
- (noch keine)

## Offene Fragen
- (noch keine)
EOF

echo "Fertig. Wiki angelegt unter: $TARGET"
echo "Nächster Schritt: 'claude' in diesem Ordner starten."
