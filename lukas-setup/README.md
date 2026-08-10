# Social-Wiki — Setup für Lukas

Gemeinsames Bearbeiten eures Wiki-Bereichs **darius-lukas** (Themen frei — u. a.
Lärmzentrale und go-Rechenkern, aber alles Weitere genauso), direkt aus Claude
Code. Dein Rechner hält einen **lokalen Spiegel**; Änderungen synchronisieren sich
per P2P (libp2p CRDT) über den Relay auf einem Hetzner-Server mit dem Host-Pi.
Kein Cloud-Konto, kein Token, keine Domain — nur libp2p (Noise-verschlüsselt).

Synchronisiert wird **nur euer Bereich** `pages/social/darius-lukas/`. Die private
Wiki des Hosts (und alles andere) bleibt außen vor. `social/` ist dabei nur der
Sammelordner für geteilte Bereiche — jeder Bereich (z. B. `darius-lukas`) ist ein
eigener, isolierter Sync-Namespace.

## Voraussetzungen
- Node ≥ 22
- Zugriff auf das Repo `github.com/blockwatcher/social-llm-wiki` (der Repo-Eigentümer muss vorher `git push`en)

## Einrichtung (einmalig)

```bash
git clone https://github.com/blockwatcher/social-llm-wiki.git
cd social-llm-wiki
npm install

# Spiegel-Verzeichnis anlegen (hier lebt deine Kopie des geteilten Bereichs)
mkdir -p ~/wiki-social/pages/social/darius-lukas
```

## Sync-Node starten

Der Node verbindet zum Relay, dialt den Host-Pi und spiegelt `pages/social/darius-lukas/`:

```bash
WIKI_SOCIAL_ROOT=~/wiki-social/pages/social \
WIKI_NAMESPACE=darius-lukas \
WIKI_STATE_DIR=~/.local/state/wiki-social \
WIKI_PEERS=/ip4/46.225.213.61/tcp/4001/p2p/12D3KooWBsYoFG7J1xq6dEQTbZyN1qULncYXRirYgSEb12fYMaKL/p2p-circuit/p2p/12D3KooWD9aujyjc34rK8rGm9NKi7tqar8UWNpZTAkyemR22E26U \
node social-sync-node.mjs
```

Beim ersten Start erzeugt er deine stabile Identität (`~/.local/state/wiki-social/node-id.key`)
und zieht die vorhandenen Seiten vom Host-Pi. Danach erscheinen sie unter
`~/wiki-social/pages/social/darius-lukas/`.

Lass den Node laufen, während du arbeitest (eigenes Terminal, oder als
systemd-User-Dienst analog zu `wiki-social-sync.service` auf dem Host-Pi — Vorlage im Repo).

## Bearbeiten aus Claude Code

Trag den Wiki-MCP in deine Claude-Code-`.mcp.json` ein (Pfade an dein System anpassen):

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/social-llm-wiki/packages/mcp-server/src/index.js"],
      "env": {
        "WIKI_ROOT": "/home/lukas/wiki-social",
        "WIKI_AUTHOR": "@lukas"
      }
    }
  }
}
```

`WIKI_AUTHOR` ist wichtig: damit werden deine Änderungen als `@lukas` signiert,
ohne dass du (oder das Modell) den Autor bei jedem Aufruf mitgeben musst.

Damit hast du in Claude Code diese Tools:
- `wiki_read` / `wiki_search` / `wiki_list` — Seiten lesen/suchen
- **`wiki_write_page`** — Seite im geteilten Bereich anlegen/ändern. Parameter:
  `slug`, `title`, `content` (Markdown-Body ohne Frontmatter), optional `folder`
  (Unterordner zum Sortieren, z. B. `laermzentrale`, `go-rechenkern` oder ein neues
  Thema wie `notizen`), optional `tags`. `author` brauchst du dank `WIKI_AUTHOR`
  nur, wenn du ausnahmsweise für jemand anderen schreibst.

  Der `slug` muss **wiki-weit eindeutig** sein — der Index adressiert Seiten über
  den Dateinamen, nicht über den Pfad. Zwei `uebersicht.md` in verschiedenen Ordnern
  kollidieren, deshalb lehnt das Tool einen schon vergebenen Slug ab und schlägt
  einen spezifischeren vor (`laermzentrale-uebersicht` statt `uebersicht`).

`wiki_write_page` schreibt nach `~/wiki-social/pages/social/darius-lukas/[<folder>/]<slug>.md`
— genau das Verzeichnis, das der Sync-Node beobachtet. Deine Änderung landet also
automatisch beim Host (und umgekehrt). `contributors` sammelt beide Autoren.

## Wichtig
- Geteilt wird **nur** `pages/social/darius-lukas/` — nach Belieben mit Unterordnern
  pro Thema. Leg nichts Privates dort ab.
- Der Schreib-Scope ist hart auf diesen Bereich begrenzt — andere Pfade lehnt das
  Tool ab.
- Bei „Verbindung steht, aber nichts synct": prüfen, dass der Sync-Node läuft und
  die `WIKI_PEERS`-Adresse exakt stimmt (das ist die Host-Pi-Circuit-Adresse oben).

## Referenz
- Relay-PeerID (Hetzner): `12D3KooWBsYoFG7J1xq6dEQTbZyN1qULncYXRirYgSEb12fYMaKL`
- Host-Pi-Node-PeerID: `12D3KooWD9aujyjc34rK8rGm9NKi7tqar8UWNpZTAkyemR22E26U`
- Namespace / GossipSub-Topic: `darius-lukas` / `social-llm-wiki/v1/darius-lukas`
