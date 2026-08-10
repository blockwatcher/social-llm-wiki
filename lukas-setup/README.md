# Social-Wiki — Setup für Lukas

Gemeinsames Bearbeiten der Wiki-Themen **Lärmzentrale** und **go-Rechenkern** mit
Darius, direkt aus Claude Code. Dein Rechner hält einen **lokalen Spiegel** der
Social-Branch; Änderungen synchronisieren sich per P2P (libp2p CRDT) über den
Relay auf Darius' Hetzner-Server mit dem Pi. Kein Cloud-Konto, kein Token, keine
Domain — nur libp2p (verschlüsselt via Noise + PeerIDs).

Nur `pages/social/` wird synchronisiert — Darius' übrige (private) Wiki bleibt bei ihm.

## Voraussetzungen
- Node ≥ 22
- Zugriff auf das Repo `github.com/blockwatcher/social-llm-wiki` (Darius muss vorher `git push`en)

## Einrichtung (einmalig)

```bash
git clone https://github.com/blockwatcher/social-llm-wiki.git
cd social-llm-wiki
npm install

# Spiegel-Verzeichnis anlegen (hier lebt deine Kopie der Social-Branch)
mkdir -p ~/wiki-social/pages/social
```

## Sync-Node starten

Der Node verbindet zum Relay, dialt Darius' Pi und spiegelt `pages/social/`:

```bash
WIKI_SOCIAL_ROOT=~/wiki-social/pages \
WIKI_STATE_DIR=~/.local/state/wiki-social \
WIKI_PEERS=/ip4/46.225.213.61/tcp/4001/p2p/12D3KooWBsYoFG7J1xq6dEQTbZyN1qULncYXRirYgSEb12fYMaKL/p2p-circuit/p2p/12D3KooWD9aujyjc34rK8rGm9NKi7tqar8UWNpZTAkyemR22E26U \
node social-sync-node.mjs
```

Beim ersten Start erzeugt er deine stabile Identität (`~/.local/state/wiki-social/node-id.key`)
und zieht die vorhandenen Seiten von Darius' Pi. Danach erscheinen sie unter
`~/wiki-social/pages/social/{laermzentrale,go-rechenkern}/`.

Lass den Node laufen, während du arbeitest (eigenes Terminal, oder als
systemd-User-Dienst analog zu `wiki-social-sync.service` auf dem Pi — Vorlage im Repo).

## Bearbeiten aus Claude Code

Trag den Wiki-MCP in deine Claude-Code-`.mcp.json` ein (Pfade an dein System anpassen):

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/social-llm-wiki/packages/mcp-server/src/index.js"],
      "env": { "WIKI_ROOT": "/home/lukas/wiki-social" }
    }
  }
}
```

Damit hast du in Claude Code diese Tools:
- `wiki_read` / `wiki_search` / `wiki_list` — Seiten lesen/suchen
- **`wiki_write_page`** — Seite in der Social-Branch anlegen/ändern. Immer mit
  `author: "@lukas"`. Beispiel-Aufruf (durch den Agenten): topic `laermzentrale`
  oder `go-rechenkern`, ein `slug`, `title`, `content` (Markdown-Body ohne
  Frontmatter), optional `tags`.

`wiki_write_page` schreibt nach `~/wiki-social/pages/social/<topic>/<slug>.md`
— genau das Verzeichnis, das der Sync-Node beobachtet. Deine Änderung landet
also automatisch bei Darius (und umgekehrt). `contributors` sammelt beide Autoren.

## Wichtig
- **Nur `pages/social/`** wird geteilt. Leg nichts Privates dort ab.
- Schreib-Scope ist hart auf die zwei Topics begrenzt — andere Pfade lehnt das
  Tool ab.
- Bei „Verbindung steht, aber nichts synct": prüfen, dass der Sync-Node läuft und
  die `WIKI_PEERS`-Adresse exakt stimmt (das ist Darius' Pi-Circuit-Adresse oben).

## Referenz
- Relay-PeerID (Hetzner): `12D3KooWBsYoFG7J1xq6dEQTbZyN1qULncYXRirYgSEb12fYMaKL`
- Darius' Pi-Node-PeerID: `12D3KooWD9aujyjc34rK8rGm9NKi7tqar8UWNpZTAkyemR22E26U`
- GossipSub-Topic: `social-llm-wiki/v1/social`
