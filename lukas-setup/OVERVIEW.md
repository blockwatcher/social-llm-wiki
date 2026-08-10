# Social-Wiki — Überblick für Lukas

Wie das gemeinsame Wiki funktioniert und wie du es benutzt. Für die reine
Installation siehe [README.md](./README.md); dieses Dokument erklärt das *Warum*
und *Wie*.

## Was das ist

Ein gemeinsamer Wiki-Bereich **darius-lukas** — Themen frei (u. a. Lärmzentrale
und go-Rechenkern, aber alles Weitere genauso), den du und dein Partner zusammen
pflegt. Es gibt keinen zentralen Server, kein Cloud-Konto und keinen Login: Jeder
von euch hat eine **lokale Kopie** der Seiten, und Änderungen gleichen sich
automatisch über eine verschlüsselte Peer-to-Peer-Verbindung ab.

Wichtig: Geteilt wird **nur** euer Bereich `pages/social/darius-lukas/`. `social/`
ist dabei nur der Sammelordner für geteilte Bereiche — jeder Bereich darin ist ein
eigener, isolierter Sync-Namespace. Die private Wiki des Hosts (und alles außerhalb
eures Bereichs) bleibt komplett bei ihm.

## Wie es funktioniert (in einem Bild)

```
   Dein Rechner                 Hetzner-Relay              Host-Raspberry-Pi
 ┌────────────────┐           (nur Treffpunkt,           ┌─────────────────────┐
 │ ~/wiki-social  │  libp2p    kennt keine Inhalte)      │ social/darius-lukas/ │
 │  …darius-lukas │◄─────────►  46.225.213.61:4001  ◄───►│ der Live-Wiki        │
 │   (Kopie)      │  (Noise-                             │                      │
 │  Sync-Node     │  verschlüsselt)                      │  Quartz :8080        │
 │  + Claude Code │                                      │  Edit-Server :7800   │
 └────────────────┘                                      └─────────────────────┘
```

- **Sync-Node**: Ein kleines Node-Programm auf deinem Rechner (`social-sync-node.mjs`).
  Es hält deine lokale Kopie von `social/darius-lukas/` aktuell. Solange es läuft,
  siehst du die Änderungen des Partners und er deine.
- **Relay** (auf einem Hetzner-Server): Nur der *Treffpunkt*, über den sich eure
  beiden Rechner finden (beide hinter Heim-Router/NAT). Der Relay leitet den
  verschlüsselten Verkehr weiter, kann die Inhalte aber nicht lesen.
- **Namespace**: Euer Bereich `darius-lukas` ist ein eigenes Yjs-Doc + GossipSub-Topic.
  Ein späterer, anderer geteilter Bereich wäre ein separater Namespace — von eurem
  isoliert.
- **CRDT (Yjs)**: Führt gleichzeitige Änderungen konfliktfrei zusammen. Bei
  *verschiedenen* Seiten passiert alles automatisch.
- **Verschlüsselung**: libp2p/Noise, Ende-zu-Ende, an Peer-Identitäten gebunden —
  deshalb weder Domain noch Zertifikat noch Passwort nötig.

## Wie du Seiten bearbeitest

Alle drei Wege schreiben dieselben Dateien und synchronisieren automatisch:

1. **Claude Code + MCP (empfohlen)** — der eigentliche Zweck. In Claude Code hast
   du `wiki_write_page`. Du sagst dem Agenten z. B. „leg eine Seite zu X an" (optional
   in einem Unterordner wie `laermzentrale`) — er schreibt sie mit `author: "@lukas"`.
   Lesen/Suchen mit `wiki_read` / `wiki_search`. Setup im README.

2. **Direkt als Markdown-Datei** — mit jedem Editor eine `.md` in
   `~/wiki-social/pages/social/darius-lukas/[<thema>/]` anlegen. Der Sync-Node
   verteilt es.

3. **(Auf der Host-Seite) über die Quartz-Weboberfläche** — dort kann man Seiten
   auch im Browser über „✎ Edit this page" bearbeiten; das synct genauso zu dir.

Jede Änderung wird mit `author` festgehalten, und `contributors` sammelt alle, die
eine Seite angefasst haben.

## Praktischer Ablauf

1. Sync-Node starten (einmal pro Sitzung, siehe README) — zieht die aktuellen
   Seiten, bleibt im Hintergrund offen.
2. In Claude Code arbeiten: lesen, recherchieren, `wiki_write_page` für neue/geänderte
   Seiten (beliebiges Thema, optional in einem Unterordner).
3. Fertig — deine Änderungen sind beim Partner, seine bei dir.

## Gut zu wissen / Grenzen

- **Der Sync-Node muss laufen**, während du arbeitest. Ist er aus, sammeln sich
  Änderungen lokal und gleichen sich beim nächsten Start ab (Offline ist ok).
- **Nach einem Neustart** kann die erste Verbindung ein paar Sekunden brauchen —
  kein Grund zur Sorge, wenn es nicht sofort klappt.
- **Gleiche Seite gleichzeitig**: Bearbeitet ihr *dieselbe* Datei im selben Moment,
  kann die zuletzt gespeicherte Fassung die andere überschreiben. Bei getrennten
  Seiten kein Thema — kurz absprechen, wenn ihr an derselben sitzt.
- **Links in die private Wiki des Hosts** funktionieren bei dir nicht: `[[…]]`, die
  auf Seiten außerhalb von `darius-lukas` zeigen, hast du lokal nicht — der Text
  kommt an, nur der Querverweis ist tot. Für geteiltes Wissen die Inhalte in euren
  Bereich schreiben.
- **Nur `pages/social/darius-lukas/`** ist geteilt. Leg dort nichts Privates ab.
- **Noch keine Zugriffskontrolle**: Wer Relay- und Peer-Adressen kennt, kann sich
  verbinden und schreiben. Adressen (im README) daher wie einen Zugangsschlüssel
  behandeln — **nicht öffentlich teilen**. Eine echte Berechtigungsschicht (DID/UCAN)
  ist geplant, aber noch nicht aktiv.

## Fragen?
Frag deinen Partner — oder in Claude Code den Agenten; er kennt das Wiki über die
`wiki_*`-Tools.
