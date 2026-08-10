# Social-Wiki — Überblick für Lukas

Wie das gemeinsame Wiki funktioniert und wie du es benutzt. Für die reine
Installation siehe [README.md](./README.md); dieses Dokument erklärt das *Warum*
und *Wie*.

## Was das ist

Ein gemeinsames Mini-Wiki für die Themen **Lärmzentrale** und **go-Rechenkern**,
das du und dein Partner zusammen pflegt. Es gibt keinen zentralen Server, kein
Cloud-Konto und keinen Login: Jeder von euch hat eine **lokale Kopie** der Seiten,
und Änderungen gleichen sich automatisch über eine verschlüsselte
Peer-to-Peer-Verbindung ab.

Wichtig: Geteilt wird **nur** der Bereich `pages/social/`. Die private Wiki des
Partners bleibt komplett bei ihm — sie ist gar nicht Teil der Synchronisation.

## Wie es funktioniert (in einem Bild)

```
   Dein Rechner                 Hetzner-Relay              Partner-Raspberry Pi
 ┌───────────────┐            (nur Treffpunkt,           ┌────────────────────┐
 │ ~/wiki-social │  libp2p     kennt keine Inhalte)      │ pages/social/ der   │
 │  pages/social │◄──────────►  46.225.213.61:4001  ◄───►│ Live-Wiki (Quartz)  │
 │   (Kopie)     │  (Noise-                              │                     │
 │               │  verschlüsselt)                       │  Quartz :8080       │
 │  Sync-Node ───┘                                       │  Edit-Server :7800  │
 │  + Claude Code│                                       └────────────────────┘
 └───────────────┘
```

- **Sync-Node**: Ein kleines Node-Programm, das auf deinem Rechner läuft
  (`social-sync-node.mjs`). Es hält deine lokale Kopie von `pages/social/`
  aktuell. Solange es läuft, siehst du die Änderungen des Partners und er deine.
- **Relay** (auf dem Hetzner-Server des Partners): Nur der *Treffpunkt*, über den sich
  eure beiden Rechner finden (beide sitzen hinter einem Heim-Router/NAT). Der
  Relay leitet den verschlüsselten Verkehr weiter, kann die Inhalte aber nicht
  lesen.
- **CRDT (Yjs)**: Die Technik, die gleichzeitige Änderungen konfliktfrei
  zusammenführt. Bearbeitet ihr *verschiedene* Seiten, passiert alles automatisch.
- **Verschlüsselung**: libp2p/Noise — Ende-zu-Ende, an Peer-Identitäten gebunden.
  Deshalb braucht es weder Domain noch Zertifikat noch Passwort.

## Wie du Seiten bearbeitest

Alle drei Wege schreiben dieselben Dateien und synchronisieren automatisch —
nimm, was dir am liebsten ist:

1. **Claude Code + MCP (empfohlen)** — der eigentliche Zweck. In Claude Code hast
   du das Tool `wiki_write_page`. Du sagst dem Agenten z. B. „leg eine Seite zu
   X in `laermzentrale` an" — er schreibt sie mit `author: "@lukas"`. Lesen/Suchen
   geht mit `wiki_read` / `wiki_search`. Setup dafür steht im README.

2. **Direkt als Markdown-Datei** — mit jedem Editor eine `.md` in
   `~/wiki-social/pages/social/<thema>/` anlegen oder ändern. Der Sync-Node merkt
   es und verteilt es.

3. **(Auf der Host-Seite) über die Quartz-Weboberfläche** — dort kann man Seiten auch im Browser
   über den „✎ Edit this page"-Button bearbeiten; das synct genauso zu dir.

Jede Änderung wird mit `author` festgehalten, und `contributors` sammelt alle,
die eine Seite angefasst haben.

## Praktischer Ablauf

1. Sync-Node starten (einmal pro Sitzung, siehe README) — er zieht die aktuellen
   Seiten und bleibt im Hintergrund offen.
2. In Claude Code arbeiten: lesen, recherchieren, `wiki_write_page` für neue/geänderte
   Seiten.
3. Fertig — deine Änderungen sind beim Partner, seine bei dir.

Der Host sieht alles zusätzlich hübsch gerendert unter `http://<host-pi>:8080`
(Quartz). Für dich reicht die lokale Markdown-Kopie + Claude Code.

## Gut zu wissen / Grenzen

- **Der Sync-Node muss laufen**, während du arbeitest. Ist er aus, sammeln sich
  deine Änderungen lokal und gleichen sich beim nächsten Start ab (Offline ist ok).
- **Nach einem Neustart** kann die erste Verbindung ein paar Sekunden brauchen,
  bis der Relay die alte Reservierung vergessen hat — kein Grund zur Sorge, wenn
  es nicht in der ersten Sekunde klappt.
- **Gleiche Seite gleichzeitig**: Bearbeitet ihr *dieselbe* Datei im selben Moment,
  kann die zuletzt gespeicherte Fassung die andere überschreiben. Für getrennte
  Seiten/Themen ist das kein Thema — kurz absprechen, wenn ihr an derselben Seite sitzt.
- **Nur `pages/social/`** ist geteilt. Leg dort nichts Privates ab.
- **Noch keine Zugriffskontrolle**: Wer die Relay- und Peer-Adressen kennt, kann
  sich verbinden und schreiben. Behandelt die Adressen (im README) daher wie einen
  Zugangsschlüssel — **nicht öffentlich teilen**. Eine echte Berechtigungsschicht
  (DID/UCAN) ist geplant, aber noch nicht aktiv.

## Fragen?
Frag deinen Partner — oder in Claude Code den Agenten; er kennt das Wiki über die
`wiki_*`-Tools.
