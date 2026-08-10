# Stufe 1 — Web-Ansicht mit Quartz

Rendert deinen Wiki-Ordner als verlinkte Website mit Graph-Ansicht, Volltextsuche
und Backlinks — read-only, lokal, mit Live-Reload beim Speichern. Das ist derselbe
Renderer, den auch das geteilte Setup nutzt.

Voraussetzung: die Wiki liegt schon (siehe [SETUP.md](./SETUP.md)), Node ≥ 22, git.

## 1. Quartz holen

```bash
git clone https://github.com/jackyzha0/quartz.git ~/quartz
cd ~/quartz
npm i
```

## 2. Deinen Wiki-Ordner als Inhalt einbinden

```bash
npx quartz create
```
Im Dialog **„Symlink your existing folder"** wählen und als Pfad deinen Wiki-Ordner
angeben (`~/mein-wiki`). Bei der Link-Auflösung **„Treat links as shortest path"**
ist eine gute Wahl — dann funktionieren `[[slug]]`-Wikilinks wie in der Wiki.

> Manuelle Alternative statt des Dialogs:
> ```bash
> rm -rf ~/quartz/content && ln -s ~/mein-wiki ~/quartz/content
> ```

## 3. Bauen & anschauen

```bash
npx quartz build --serve
```
Öffne **http://localhost:8080**. Solange der Befehl läuft, baut Quartz bei jeder
Änderung an einer `.md` automatisch neu — du siehst Neues also live.

Das war's für die Basis-Web-Ansicht.

## Optional: Aufräumen, was im Web erscheint

Standardmäßig rendert Quartz **alles** unter `content/` — also auch `CLAUDE.md`,
`SCHEMA.md` und die Rohquellen in `_sources/`. Wenn du die aus der Web-Ansicht
raushalten willst, in `~/quartz/quartz.config.ts` bei `ignorePatterns` ergänzen:

```ts
ignorePatterns: ["private", "templates", ".obsidian", "CLAUDE.md", "_sources/**"],
```
(`SCHEMA.md` würde ich sichtbar lassen — praktisch als Referenz. Geschmackssache.)

## Optional: dauerhaft laufen lassen

`npx quartz build --serve` läuft nur, solange das Terminal offen ist. Für „immer
an" gibt es zwei übliche Wege:
- **systemd-User-Dienst**, der `npx quartz build --serve` in `~/quartz` startet
  (analog zu den Diensten auf dem Host-Pi).
- Oder nur bei Bedarf starten — für eine persönliche Wiki völlig ausreichend.

## Zusammenspiel mit dem Bearbeiten

Quartz **zeigt** nur an; bearbeitet wird weiter über Claude Code (Stufe 2) oder
direkt in den Dateien. Wer auch im Browser editieren will, kann zusätzlich den
**Edit-Server** aus diesem Repo (`packages/edit-server`, `WIKI_ROOT=~/mein-wiki`)
laufen lassen — der ergänzt einen „✎ Edit this page"-Button. Für den Anfang nicht
nötig.

## Wenn etwas klemmt
- **Leere/kaputte Seite nach dem Build:** meist ein YAML-Frontmatter-Fehler (Wert
  mit `:` `@` `—` ohne Quotes). Genau dagegen quoten die Vorlagen — im Zweifel die
  zuletzt geänderte Seite prüfen.
- **`[[Links]]` gehen ins Leere:** der Linkname muss dem Dateinamen ohne `.md`
  entsprechen, und Dateinamen sollten wikiweit eindeutig sein.
