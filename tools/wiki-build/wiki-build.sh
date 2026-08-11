#!/usr/bin/env bash
# wiki-build.sh — ein Quartz-Rebuild, der nie eine funktionierende Ansicht zerstört.
#
# Ersetzt den nackten `npx quartz build`. Drei Schichten, jede gegen einen Ausfall,
# den es in der Praxis gab (siehe README.md):
#
#   1. No-op-Guard     — nichts geändert, nichts gebaut.
#   2. Guard auf Kopie — gebaut wird aus einem Staging-Abzug; Seiten mit kaputtem
#                        YAML-Frontmatter degradieren dort zu sichtbaren Stubs,
#                        statt den ganzen Build zu killen.
#   3. Atomarer Build  — in ein Temp-Verzeichnis bauen, nur bei Erfolg umschwenken.
#
# Konfiguration ausschließlich über Umgebungsvariablen — keine Pfade im Skript:
#
#   WIKI_SOURCE   (Pflicht)  Markdown-Baum, der gerendert wird
#   QUARTZ_DIR    (Pflicht)  Quartz-Checkout (dort entsteht public/)
#   WIKI_BUILD_STATE         Zustandsablage. Default: $XDG_STATE_HOME/wiki-build
#   WIKI_BUILD_EXCLUDE       rsync-Ausschluss, mehrfach per Komma.
#                            Default: .history/ (Verlaufsordner des Edit-Servers)
#
# Aufruf:  WIKI_SOURCE=~/wiki QUARTZ_DIR=~/quartz ./wiki-build.sh [--force]

set -uo pipefail

log() { echo "[wiki-build] $*"; }
die() { echo "[wiki-build] FEHLER: $*" >&2; exit 2; }

: "${WIKI_SOURCE:?WIKI_SOURCE ist nicht gesetzt (Markdown-Baum)}"
: "${QUARTZ_DIR:?QUARTZ_DIR ist nicht gesetzt (Quartz-Checkout)}"

WIKI="${WIKI_SOURCE%/}"
QUARTZ="${QUARTZ_DIR%/}"
STATE="${WIKI_BUILD_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/wiki-build}"
STAGING="$STATE/content"
QUARANTINE="$STATE/quarantine"
STAMP="$STATE/last-build-hash"
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/frontmatter_guard.py"

[[ -d "$WIKI"   ]] || die "WIKI_SOURCE existiert nicht: $WIKI"
[[ -d "$QUARTZ" ]] || die "QUARTZ_DIR existiert nicht: $QUARTZ"
[[ -f "$GUARD"  ]] || die "frontmatter_guard.py fehlt neben diesem Skript"
command -v rsync   >/dev/null || die "rsync fehlt"
command -v python3 >/dev/null || die "python3 fehlt"
python3 -c 'import yaml' 2>/dev/null || die "python3-yaml (pyyaml) fehlt"

mkdir -p "$STATE" "$QUARANTINE"

RSYNC_EXCLUDES=()
IFS=',' read -ra _ex <<< "${WIKI_BUILD_EXCLUDE:-.history/}"
for e in "${_ex[@]}"; do [[ -n "$e" ]] && RSYNC_EXCLUDES+=(--exclude "$e"); done

# ── Schicht 1: No-op-Guard ───────────────────────────────────────────────────
# Hash über Inhalt UND Pfade, damit Umbenennungen und Löschungen zählen.
HASH=$(find "$WIKI" -type f -name '*.md' -exec sha1sum {} + | sort | sha1sum | cut -d' ' -f1)
if [[ "${1:-}" != "--force" && -f "$STAMP" && "$(cat "$STAMP")" == "$HASH" && -d "$QUARTZ/public" ]]; then
  log "keine Änderung — Build übersprungen"
  exit 0
fi

# ── Schicht 2: Staging + Frontmatter-Guard ───────────────────────────────────
if ! rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$WIKI/" "$STAGING/"; then
  die "Staging-Kopie fehlgeschlagen — Build abgebrochen, bisherige Ansicht bleibt"
fi

REPORT=$(python3 "$GUARD" --source "$WIKI" --staging "$STAGING" --quarantine "$QUARANTINE" 2>&1)
if [[ $? -ne 0 ]]; then
  # Der Guard soll nie der Grund sein, dass nicht gebaut wird.
  log "WARNUNG: Guard fehlgeschlagen, baue ungeprüft weiter:"
  echo "$REPORT" | head -5 >&2
else
  echo "$REPORT" > "$STATE/last-guard-report.json"
  SUMMARY=$(echo "$REPORT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r,i=len(d['repaired']),len(d['isolated'])
print(f'{r} repariert, {i} isoliert' if r or i else '')" 2>/dev/null)
  [[ -n "$SUMMARY" ]] && log "Guard: $SUMMARY"
fi

# Der Guard darf die Quelle repariert haben — dann ist der gebaute Stand ein anderer
# als der, mit dem wir gestartet sind. Ab hier zählt dieser: er geht in den Stempel und
# in den Nachhol-Vergleich. Sonst gilt die eigene Reparatur als Fremdänderung und löst
# einen zweiten, vollständig überflüssigen Build aus.
HASH=$(find "$WIKI" -type f -name '*.md' -exec sha1sum {} + | sort | sha1sum | cut -d' ' -f1)

# ── Schicht 3: Atomarer Build ────────────────────────────────────────────────
cd "$QUARTZ" || die "$QUARTZ nicht erreichbar"
rm -rf public.new

if npx quartz build -d "$STAGING" -o public.new; then
  # Stempel INS Ergebnis: so lässt sich von außen prüfen, ob das Ausgelieferte zum
  # Gebauten gehört — gegen die stille Divergenz, bei der ein Dienst ein anderes
  # Verzeichnis baut als serviert wird und nichts fehlschlägt.
  python3 - "$QUARTZ/public.new/.build-stamp.json" "$HASH" "$WIKI" <<'PY'
import json, sys
from datetime import datetime, timezone
path, content_hash, source = sys.argv[1:4]
json.dump({'built_at': datetime.now(timezone.utc).isoformat(),
           'content_hash': content_hash,
           'source': source}, open(path, 'w'), indent=2)
PY
  rm -rf public.old
  [[ -d public ]] && mv public public.old
  mv public.new public
  echo "$HASH" > "$STAMP"
  rm -rf public.old
  log "Build OK"

  # Während des Builds geschriebene Änderungen nachziehen. Wird der Build von einem
  # Watcher per `systemctl start` angestoßen, blockiert der Aufruf bei einem oneshot
  # bis zum Ende — der Watcher nimmt in der Zeit keine Ereignisse entgegen, und eine
  # dabei geschriebene Änderung würde nie gebaut.
  AFTER=$(find "$WIKI" -type f -name '*.md' -exec sha1sum {} + | sort | sha1sum | cut -d' ' -f1)
  PASS="${WIKI_BUILD_PASS:-1}"
  if [[ "$AFTER" != "$HASH" && "$PASS" -lt 3 ]]; then
    log "Quelle hat sich während des Builds geändert — Durchlauf $((PASS + 1))"
    WIKI_BUILD_PASS=$((PASS + 1)) exec "$0" "$@"
  elif [[ "$AFTER" != "$HASH" ]]; then
    log "WARNUNG: Quelle ändert sich schneller als der Build läuft — aufgegeben" >&2
  fi
  exit 0
else
  rm -rf public.new
  log "BUILD FEHLGESCHLAGEN — die bisherige Ansicht bleibt aktiv" >&2
  exit 1
fi
