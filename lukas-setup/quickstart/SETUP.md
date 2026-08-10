# Eigene LLM-Wiki in 10 Minuten

Der schnellste Weg zu einer agentengestützten persönlichen Wiki — **nur Claude
Code nötig**, kein Server, kein MCP. (Web-Ansicht & Co. kommen optional später,
siehe [PRIVATE-WIKI.md](../PRIVATE-WIKI.md).)

## Voraussetzung
- Claude Code installiert.
- (Nur für den optionalen Quartz-Schritt später: Node ≥ 22.)

## Schritt 1 — Grundgerüst anlegen (1 Min)

Aus diesem Repo:
```bash
bash lukas-setup/quickstart/scaffold-wiki.sh ~/mein-wiki
```
Das erzeugt in `~/mein-wiki`:
- `SCHEMA.md` — die Regeln (Seitenformat, Kategorien)
- `CLAUDE.md` — bringt Claude Code die Konventionen bei
- `wiki-index.md`, `log.md`
- `pages/<kategorien>/` + `_sources/`
- eine `beispiel-seite.md` als Vorlage

(Ordner frei wählbar; er muss leer/neu sein.)

## Schritt 2 — Claude Code im Wiki-Ordner starten (1 Min)

```bash
cd ~/mein-wiki
claude
```
Claude liest automatisch `CLAUDE.md` (und darüber `SCHEMA.md`) und weiß damit, wie
es die Wiki pflegt. **Kein weiteres Setup** — es arbeitet mit seinen normalen
Datei-Werkzeugen direkt auf den `.md`-Dateien.

## Schritt 3 — Loslegen (der Rest der 10 Minuten)

Beispiel-Anweisungen an den Agenten:
- „Fass mir das hier als Wiki-Seite unter `technik` zusammen: <Text/Link/Notiz>."
  → legt eine regelkonforme Seite an, aktualisiert `wiki-index.md` + `log.md`.
- „Was weiß ich über <Thema>?" → durchsucht die Wiki und antwortet mit Quelle.
- „Verlinke die neue Seite mit verwandten Seiten." → setzt `[[wikilinks]]`.

Wenn deine erste echte Seite steht: `pages/technik/beispiel-seite.md` und ihre
Zeile in `wiki-index.md` löschen.

## Das war's

Du hast jetzt eine wachsende, durchsuchbare, agentengestützte Wissensbasis — pur
aus Markdown, ohne Infrastruktur. Sichere den Ordner wie jeden anderen (Git,
Backup).

## Wenn du mehr willst (optional, später)

- **Web-Ansicht mit Graph & Suche:** Quartz über den Ordner legen — Schritt für
  Schritt in [QUARTZ.md](./QUARTZ.md).
- **Strukturierte Tools / Claude Desktop / Lücken-Analyse:** den MCP-Server aus
  diesem Repo mit `WIKI_ROOT=~/mein-wiki` einbinden.
- **Selbst-kuratierende Pipeline:** Auto-Ingest + LLM-Review.

Alle drei sind in [PRIVATE-WIKI.md](../PRIVATE-WIKI.md) erklärt (Stufen 1, 3, 4).

## Ganz ohne Agent?
Geht auch: Der Ordner ist einfach Markdown. Du kannst Seiten von Hand anlegen und
mit `grep`/jedem Editor arbeiten — der Agent ist nur ein Beschleuniger, keine
Voraussetzung.
