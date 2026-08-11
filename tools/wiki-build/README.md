# wiki-build — ein Quartz-Rebuild, der nie eine funktionierende Ansicht zerstört

Wrapper um `npx quartz build` für Leute, die ihre LLM-Wiki mit
[Quartz](https://quartz.jzhao.xyz/) rendern und den Build automatisch laufen lassen
(Cron, systemd-Timer, inotify-Watcher).

Der nackte Build hat zwei Eigenschaften, die im Alltag wehtun: er stirbt an einer
einzigen kaputten Seite, und er löscht `public/` bevor er das neue Ergebnis hat.
Beides zusammen heißt: ein Tippfehler im Frontmatter kann die gerenderte Wiki
**einfrieren oder leeren**, ohne dass jemand es merkt.

---

## Was passiert ist (damit klar ist, wogegen das hilft)

**Der laute Ausfall.** Eine unquotete Zeile — `author: @darius`, wobei `@` in YAML
kein Token beginnen darf — ließ den Build scheitern. Der automatische Rebuild lief
weiter, schlug weiter fehl, und die gerenderte Wiki blieb **tagelang** auf dem alten
Stand. Erschwerend: der Quartz-Fehler zeigte auf die *nächste* Zeile.

**Der leise Ausfall.** Nach einem Versionswechsel baute der Dienst ein anderes
Verzeichnis, als der Server auslieferte. Nichts schlug fehl, kein Log meldete etwas —
die Ansicht fror einfach ein und blieb **13 Tage** stehen, bis es jemandem auffiel.

Die Idee zur ersten Klasse stammt von [OpenWiki](https://github.com/langchain-ai/openwiki):
ein kaputtes Element degradiert in-place, statt den ganzen Lauf mitzureißen.

---

## Die drei Schichten

**1. No-op-Guard.** Hash über Inhalt *und* Pfade aller `*.md`. Unverändert ⇒ kein
Build. Ein inotify-Watcher feuert auf jedes Dateiereignis, nicht nur auf echte
Änderungen; ohne das kostet jedes `touch` einen vollen Rebuild.

**2. Frontmatter-Guard auf einer Staging-Kopie.** Gebaut wird aus einem `rsync`-Abzug,
nicht aus dem Original. Dort:

- **reparierbar** (ein Skalar, dem nur Anführungszeichen fehlen) → korrigiert, und
  zwar auch in der Quelle — aber nur wenn das Ergebnis parst *und* danach dieselben
  Schlüssel trägt wie vorher, und erst nachdem das Original in die Quarantäne kopiert
  wurde;
- **unreparierbar** → wird **nur in der Kopie** zu einem sichtbar markierten Stub
  („⚠️ Frontmatter defekt"). Die Quelle bleibt unangetastet.

Warum nicht in der Quelle degradieren: ein Timer, der Inhalte automatisch durch
Platzhalter ersetzt, braucht ein Undo. Ist der Wiki-Baum nicht versioniert, gibt es
keins. Und synchronisiert ein Teil des Baums zu anderen Personen, würde der
Platzhalter dort obendrein veröffentlicht.

**3. Atomarer Build.** Es wird nach `public.new` gebaut und erst bei Erfolg
umgeschwenkt. Ein Fehlschlag lässt die laufende Ansicht stehen, statt sie zu leeren.

Zusätzlich schreibt der Build einen **Stempel** (`public/.build-stamp.json`) mit
Zeitpunkt, Content-Hash und Quellpfad. Damit lässt sich von außen prüfen, ob das
Ausgelieferte zum Gebauten gehört — das Gegenmittel gegen die leise Klasse. Und nach
einem erfolgreichen Lauf wird die Quelle erneut gehasht: hat sie sich *währenddessen*
geändert, läuft der Build noch einmal (max. 3 Durchläufe).

---

## Voraussetzungen

`bash`, `rsync`, `python3` mit `pyyaml`, und ein funktionierendes Quartz-Setup.

```bash
sudo apt install rsync python3-yaml     # Debian/Ubuntu
```

## Benutzung

Alle Pfade kommen aus der Umgebung, im Skript steht keiner:

```bash
export WIKI_SOURCE=$HOME/wiki-social      # der Markdown-Baum
export QUARTZ_DIR=$HOME/quartz            # das Quartz-Checkout (dort entsteht public/)
tools/wiki-build/wiki-build.sh            # --force baut auch ohne Änderung
```

| Variable | | |
|---|---|---|
| `WIKI_SOURCE` | Pflicht | Markdown-Baum, der gerendert wird |
| `QUARTZ_DIR` | Pflicht | Quartz-Checkout |
| `WIKI_BUILD_STATE` | optional | Zustandsablage, Default `$XDG_STATE_HOME/wiki-build` |
| `WIKI_BUILD_EXCLUDE` | optional | rsync-Ausschlüsse, kommagetrennt. Default `.history/` |

Fehlt eine Pflichtvariable oder ein Werkzeug, bricht das Skript **vor** dem ersten
Schreibzugriff mit einer klaren Meldung ab.

Im Zustandsverzeichnis landen: die Staging-Kopie, `last-build-hash`,
`last-guard-report.json` und `quarantine/` mit den Originalen aller Seiten, die der
Guard angefasst hat (nach Zeitstempel sortiert).

## Als systemd-Timer

```ini
# ~/.config/systemd/user/wiki-build.service
[Service]
Type=oneshot
Environment=WIKI_SOURCE=%h/wiki-social
Environment=QUARTZ_DIR=%h/quartz
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=%h/social-llm-wiki/tools/wiki-build/wiki-build.sh
```

Wird der Dienst von einem Watcher per `systemctl start` angestoßen: das **blockiert**
bei einem `oneshot` bis zum Ende, der Watcher nimmt währenddessen keine Ereignisse
entgegen. Genau dagegen ist der Nachhol-Durchlauf oben.

Und beim Testen: während `ExecStart` läuft, steht der Dienst auf `activating`, nicht
`active` — ein `until ! systemctl is-active`-Loop kehrt sofort zurück.

## Den Stempel auswerten

```bash
python3 - "$QUARTZ_DIR/public/.build-stamp.json" "$WIKI_SOURCE" <<'PY'
import json, subprocess, sys
stamp = json.load(open(sys.argv[1]))
cur = subprocess.run(['bash','-c',
    f"find {sys.argv[2]} -type f -name '*.md' -exec sha1sum {{}} + | sort | sha1sum | cut -d' ' -f1"],
    capture_output=True, text=True).stdout.strip()
print('aktuell' if cur == stamp['content_hash'] else 'ABWEICHUNG — es wurde etwas geändert, das nie gebaut wurde')
print('gebaut:', stamp['built_at'], 'aus', stamp['source'])
PY
```

Ein Unterschied direkt nach einer Bearbeitung ist normal — der Build zieht erst nach.
Meldenswert wird er, wenn er **anhält**: dann kommt nichts mehr, das ihn auflöst.
