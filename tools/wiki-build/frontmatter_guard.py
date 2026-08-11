#!/usr/bin/env python3
"""
Frontmatter-Guard — kaputte Seiten isolieren, statt den Build sterben zu lassen.

Am 18.05.2026 hat eine einzige Zeile (`author: @darius`, unquotet) den
Quartz-Rebuild tagelang blockiert und die gerenderte Wiki eingefroren. Das
Muster stammt von OpenWiki: ein defektes Element degradiert in-place, der Build
läuft weiter, und der Fehler bleibt sichtbar statt alles mitzureißen.

Zwei Klassen, unterschiedlich riskant, deshalb unterschiedlich behandelt:

  * **Reparierbar** — ein Skalar, dem nur Anführungszeichen fehlen (`@` am
    Anfang, `:` im Wert). Wird in der Quelle korrigiert, aber nur wenn das
    Ergebnis parst UND danach exakt dieselben Schlüssel trägt wie der Versuch
    davor. Eine Reparatur, die den Sinn ändert, ist keine.
  * **Unreparierbar** — alles andere. Wird NUR im Staging zu einem sichtbar
    markierten Stub; die Quelle bleibt unangetastet. Der Grund: ein Timer, der
    Inhalte automatisch durch Platzhalter ersetzt, braucht ein Undo. Ist der
    Wiki-Baum nicht versioniert, gibt es keins. Und synchronisiert ein Teil des
    Baums zu anderen Personen (geteilte Bereiche), würde der Platzhalter dort
    obendrein veröffentlicht — die Peers bekämen eine Warnseite statt Inhalt.

Vor jeder Reparatur in der Quelle wird das Original weggeschrieben — auch wenn
die Reparatur trivial aussieht.

    frontmatter_guard.py --source <wiki> --staging <dir> --quarantine <dir>
                         [--report-only]
"""

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Zeichen, die am Anfang eines unquoteten YAML-Skalars den Parser kippen.
LEADING = '@`%*&!|>?'
KV_RE = re.compile(r'^(\s*[A-Za-z_][\w.-]*:\s*)(\S.*)$')


def split_frontmatter(text: str):
    """(vorspann, rest) — oder (None, text), wenn die Datei keinen Block hat."""
    if not text.startswith('---'):
        return None, text
    end = text.find('\n---', 3)
    if end == -1:
        return None, text
    return text[3:end].lstrip('\n'), text[end + 4:]


def quote_scalar(value: str):
    """Gibt den gequoteten Wert zurück, oder None wenn nichts zu tun ist."""
    v = value.strip()
    if not v or v[0] in '"\'[{':
        return None                      # schon gequotet oder Collection
    if v[0] in LEADING or ':' in v:
        return '"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return None


def try_repair(fm: str):
    """Repariert fehlende Anführungszeichen. Gibt den neuen Block zurück oder None.

    Die Reparatur gilt nur als gelungen, wenn der Block danach parst und ein
    Mapping mit denselben Schlüsseln ergibt, die die kaputten Zeilen nahelegen —
    sonst hätte das Quoting die Struktur verschoben statt sie zu retten.
    """
    expected = set()
    out = []
    for line in fm.splitlines():
        m = KV_RE.match(line)
        if m:
            expected.add(m.group(1).split(':')[0].strip())
            quoted = quote_scalar(m.group(2))
            if quoted is not None:
                line = m.group(1) + quoted
        out.append(line)
    candidate = '\n'.join(out)

    try:
        parsed = yaml.safe_load(candidate)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if not expected.issubset(set(parsed.keys())):
        return None
    return candidate


def stub_for(rel: Path, error: str, body: str) -> str:
    title = str(rel).replace('"', "'")
    first = error.splitlines()[0].replace('"', "'")[:160]
    return (
        '---\n'
        f'title: "⚠️ Frontmatter defekt — {title}"\n'
        'category: technik\n'
        f'updated: {datetime.now(timezone.utc).date().isoformat()}\n'
        '---\n\n'
        '> **Diese Seite hat ungültiges YAML-Frontmatter und wurde für den Build isoliert.**\n'
        f'> Fehler: `{first}`\n'
        '>\n'
        '> Die Originaldatei ist unverändert; nur diese Render-Ansicht ist ersetzt.\n'
        '> Nach der Korrektur verschwindet der Hinweis beim nächsten Build von selbst.\n\n'
        '---\n\n'
        + body
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', required=True, help='Wiki-Quellbaum (Wahrheit)')
    ap.add_argument('--staging', required=True, help='Kopie, aus der gebaut wird')
    ap.add_argument('--quarantine', required=True, help='Ablage für Originale vor Eingriffen')
    ap.add_argument('--report-only', action='store_true', help='nichts schreiben, nur melden')
    args = ap.parse_args()

    source, staging = Path(args.source), Path(args.staging)
    quarantine = Path(args.quarantine)
    repaired, isolated, failed = [], [], []

    for staged in sorted(staging.rglob('*.md')):
        if not staged.is_file():
            continue
        rel = staged.relative_to(staging)
        try:
            text = staged.read_text(encoding='utf-8')
        except Exception as e:
            failed.append({'path': str(rel), 'error': f'nicht lesbar: {e}'})
            continue

        fm, body = split_frontmatter(text)
        if fm is None:
            continue                     # kein Frontmatter — Quartz stört das nicht
        try:
            yaml.safe_load(fm)
            continue                     # valide
        except Exception as exc:
            error = str(exc)

        fixed = try_repair(fm)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')

        if fixed is not None:
            new_text = '---\n' + fixed + '\n---' + body
            if args.report_only:
                repaired.append({'path': str(rel), 'applied': False})
                continue
            staged.write_text(new_text, encoding='utf-8')
            # Auch in die Quelle — aber erst nachdem das Original gesichert ist.
            origin = source / rel
            if origin.is_file():
                keep = quarantine / 'repaired' / stamp / rel
                keep.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, keep)
                origin.write_text(new_text, encoding='utf-8')
            repaired.append({'path': str(rel), 'applied': True})
            continue

        # Unreparierbar: nur die Kopie ersetzen, Quelle nie.
        if not args.report_only:
            origin = source / rel
            if origin.is_file():
                keep = quarantine / 'broken' / stamp / rel
                keep.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, keep)
            staged.write_text(stub_for(rel, error, body), encoding='utf-8')
        isolated.append({'path': str(rel), 'error': error.splitlines()[0][:200]})

    report = {'repaired': repaired, 'isolated': isolated, 'failed': failed}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    # Rückgabe 0 auch bei Funden: der Build soll weiterlaufen, das ist der Zweck.
    return 0


if __name__ == '__main__':
    sys.exit(main())
