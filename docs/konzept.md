# Social LLM Wiki — Konzept und Stand

Persönliches Wiki, kuratiert von einem LLM-Agenten, mit geteilten Bereichen,
die sich konfliktfrei per CRDT zwischen mehreren Rechnern abgleichen — ohne
zentralen Server.

**Stand: 2026-08-11.** Dieses Dokument beschreibt, was *gebaut ist und läuft*.
Was aus der ursprünglichen Vision nicht umgesetzt wurde, steht am Ende unter
[Verworfen und offen](#verworfen-und-offen) — bewusst als solches markiert,
statt als Plan getarnt.

---

## Das Wiki

**Die maßgebliche Wiki liegt unter `nanoclaw/groups/main/memory/wiki/`** — nicht
im `wiki/`-Verzeichnis dieses Repos. Das ist die häufigste Fehlerquelle: MCP-Server,
Edit-Server und Quartz zeigen alle auf den nanoclaw-Baum. Wer `WIKI_ROOT` vergisst,
schreibt in einen toten Baum, und die Notizen tauchen nie auf.

```
wiki/
  SCHEMA.md            Regeln: Seitenformat, Ingest-Disziplin, Frontmatter
  wiki-index.md        alle Seiten, je eine Zeile
  log.md               Änderungsprotokoll, neueste zuerst
  _sources/            Rohmaterial, nach Ingest unveränderlich
  inbox/               Kurzzeitgedächtnis: lint, notes, projekte, sessions
  pages/               kuratierte Seiten (derzeit 293)
    bildung/ daten/ personen/ projekte/ reisen/ technik/ urlaub/ wissen/
    social/            geteilte Bereiche → siehe unten
```

Zwei Dinge, die man wissen muss, bevor man Seiten anlegt:

- **Dateinamen müssen wiki-weit eindeutig sein.** Index und Lint adressieren
  Seiten über den Dateinamen-Stamm, nicht über den Pfad. Zwei `uebersicht.md` in
  verschiedenen Ordnern kollidieren, und eine fällt still aus dem Index.
- **YAML im Frontmatter quoten,** sobald Sonderzeichen vorkommen (`@`, `:`,
  Gedankenstriche). Eine unquotierte Zeile kippt den Quartz-Build.

---

## Geteilte Bereiche

Unter `pages/social/` liegen die gemeinsam bearbeiteten Bereiche. `social/` ist
nur der Sammelordner — **jeder Bereich darunter ist eine eigene Gruppe und ein
eigener Sync-Namespace** mit eigenem Yjs-Dokument, eigenem GossipSub-Topic und
eigenem Peer-Kreis. Gruppen sind damit gegeneinander isoliert, und der private
Teil des Wikis bleibt außen vor.

```
pages/social/
  darius-lukas/        erste Gruppe
    go-rechenkern/
    laermzentrale/
```

Eine neue Gruppe = ein neuer Ordner + ein Sync-Node mit passendem
`WIKI_NAMESPACE`. Keine Änderung am Code.

### Verweise auf private Seiten

Eine geteilte Seite erreicht jeden Peer der Gruppe. Ein `[[Wikilink]]` auf eine
Seite außerhalb der Gruppe tut deshalb zwei unerwünschte Dinge: er zeigt beim
Peer ins Leere, und er verrät den Namen der privaten Seite. **Solche Verweise
gehören als Klartext in den Fließtext**, nicht in doppelte Klammern.

Die Regel wird an drei Stellen durchgesetzt, weil nicht alle Schreiber denselben
Weg nehmen:

| Stelle | Wann | Wen deckt sie ab |
|---|---|---|
| `wiki_write_page` (MCP) | beim Schreiben | MCP-Clients |
| Publish-Gate im Sync-Node | beim Veröffentlichen | **alle** Schreiber |
| `wiki-lint.py` | sonntags | alle, nachträglich |

Das Gate ist die eigentliche Garantie: eine Seite mit privatem Link wandert gar
nicht erst ins Yjs-Dokument. Die lokale Datei bleibt unangetastet, und war die
Seite vorher schon veröffentlicht, behalten die Peers die letzte saubere Fassung.
Zurückgehaltene Seiten stehen in `<stateDir>/blocked-<namespace>.json`.

Ein Link, der *nirgends* auflöst, geht durch — er nennt keine existierende Seite.

---

## Sync

Yjs als CRDT, libp2p 3.x als Transport, GossipSub zur Verteilung. Topic pro
Namespace: `social-llm-wiki/v1/<namespace>`.

Weil beide Seiten hinter NAT sitzen, läuft die Verbindung über einen
**Circuit-Relay** (libp2p circuit-relay-v2) auf einem Hetzner-Server. Der Relay
vermittelt nicht nur, er trägt auch den Datenverkehr — sein Default-Limit
(~128 KB / 2 min) ist dafür abgeschaltet, was bei Wiki-Textmengen unkritisch ist.

Jeder Node hat eine **stabile Ed25519-Identität** aus einer Keyfile, seine PeerID
bleibt also über Neustarts gleich. Peers verbinden sich, indem sie die
Circuit-Adresse des anderen wählen — der Relay selbst gossippt nicht.

Der Node bringt drei Eigenschaften mit, die im Betrieb wichtiger sind als der
Sync selbst:

- **Publish-Gate** — siehe oben.
- **Löschweitergabe.** Eine gelöschte Datei verschwindet auch beim Peer.
  Löschungen werden nach einer Karenzzeit bestätigt (ein Speichervorgang, der die
  Datei kurz entfernt, gilt nicht als Löschung), und ein Löschen bei gestopptem
  Dienst wird beim Start abgeglichen. Ausnahme: leeres Verzeichnis neben
  nicht-leerem State ⇒ wiederherstellen, nicht bei allen Peers löschen.
- **Reconnect mit Backoff.** Relay- und Peer-Verbindungen werden überwacht und
  neu aufgebaut (5s, verdoppelnd bis 5min). Ohne das lief der Node nach einem
  Verbindungsabbruch weiter, ohne zu senden und ohne etwas zu melden.

---

## Die LLM-Schicht

Kuratiert wird nach dem Karpathy-Muster, ausgeführt vom Agenten (Kai, läuft in
NanoClaw):

- **`wiki ingest <slug> "<titel>"`** — Rohmaterial nach `_sources/`, daraus eine
  neue Seite oder eine datierte Ergänzung an einer bestehenden; Index und Log
  werden mitgezogen. Schreibt in die **privaten** `pages/<kategorie>/`.
- **`wiki query "<thema>"`** — findet vorhandenes Wissen, über Index und grep.
- **`wiki lint`** — Konsistenzprüfung.

Der Agent hat **keinen MCP-Zugriff** — er arbeitet direkt auf den Dateien, da
ihm der Wiki-Baum ohnehin gemountet ist. Für den geteilten Bereich legt er
Seiten deshalb als Datei an, nicht über `wiki ingest`.

Sonntags 09:00 läuft `wiki-lint.py` als systemd-Timer und legt einen Report in
`memory/drop/`, den der Agent liest und in konkrete Vorschläge übersetzt. Der
Lint prüft unter anderem gebrochene Wikilinks, Namens-Kollisionen, Privatlinks im
geteilten Bereich, Index-Drift und Konsolidierungs-Kandidaten (welche Seiten
thematisch zusammengehören, aber nicht verlinkt sind).

Die Inbox (`inbox/`) ist Kurzzeitgedächtnis: Notizen aus externen Sessions landen
dort mit `promoted: false` und werden bei Gelegenheit in kuratierte Seiten
gefaltet.

---

## Zugänge

| Dienst | Adresse | Was |
|---|---|---|
| MCP (stdio) | pro Session gestartet | Wiki als Werkzeug in Claude Code |
| MCP (HTTP) | `:8787/mcp` | dasselbe über LAN, `wiki-mcp.service` |
| Edit-Server | `:7800` | Seiten im Browser bearbeiten |
| Quartz | `:8080` | gerenderte Wiki, read-only |

Der MCP-Server bietet sieben Werkzeuge: `wiki_list`, `wiki_read`, `wiki_search`,
`wiki_write_inbox`, `wiki_write_page`, `wiki_graph`, `wiki_gaps`. Konfiguriert
wird er über Umgebungsvariablen — `WIKI_ROOT` (Pflicht in der Praxis),
`WIKI_AUTHOR` (wer schreibt; sonst wird falsch signiert), `WIKI_SHARED_GROUPS`
(welche geteilten Gruppen dieser Server bedienen darf).

Die HTTP-Variante hört auf allen Interfaces und ist **ohne Token** — sie ist für
das LAN gedacht. `WIKI_HTTP_TOKEN` schaltet Bearer-Auth ein.

### Laufende Dienste

| Unit | Zustand |
|---|---|
| `wiki-mcp.service` (user) | läuft |
| `wiki-social-sync.service` (user) | läuft |
| `wiki-edit-server.service` | läuft |
| `quartz-watcher.service` | läuft, triggert `quartz-rebuild.service` |
| `wiki-lint.timer` | wöchentlich |

Die Unit-Dateien `wiki-review.service` und `wiki-file-watch.service` liegen im
Repo, sind aber **nicht installiert** — der automatische Review-Schritt und der
Drop-Ordner-Channel laufen nicht.

---

## Verworfen und offen

Die ursprüngliche Fassung dieses Dokuments (Mai 2026) beschrieb einen deutlich
größeren Entwurf. Was davon nicht gebaut wurde und warum:

| Geplant | Stand |
|---|---|
| **DIDs** für Identität | Ersetzt durch libp2p-PeerIDs aus persistenten Keyfiles. Genügt für einen kleinen, bekannten Peer-Kreis. |
| **UCAN** für Berechtigungen | Nicht gebaut. Zugriff regeln stattdessen: Pfad-Scope beim Schreiben, ein Sync-Namespace je Gruppe, das Publish-Gate. |
| **Meilisearch** | Nicht gebaut. `wiki_search` scannt Volltext direkt — bei 293 Seiten ausreichend. |
| **Outline** für den geteilten Layer | Nicht gebaut. Quartz rendert den geteilten Bereich mit. |
| **A2A-Bot-Koordination** | Entfallen — es gibt nur einen Agenten. Der zweite Bot der Vision existiert nicht. |
| **Matrix** als Interface | Es ist WhatsApp (über NanoClaw). |
| **`review/`-Staging-Schicht** | Nicht gebaut. Promotion läuft über `promoted: false` im Frontmatter plus Kuration. |
| **Schema-Hierarchie** (`geo/track`, `media/photo`, …) und Geo-Channels | Nicht gebaut. Die Inbox hat vier Channels: `lint`, `notes`, `projekte`, `sessions`. |
| **Namespaces `@person/` und `groups/`** | Anders gelöst: Kategorien unter `pages/`, geteilte Bereiche unter `pages/social/<gruppe>/`. |

Offene Punkte, die tatsächlich anstehen:

- **Sichtbarkeit des Syncs.** Nach einem Schreibvorgang gibt es keine Antwort auf
  „ist das beim anderen angekommen, ist er überhaupt online". Ein
  `wiki_sync_status` bräuchte einen Status-Endpoint am Sync-Node.
- **Umbenennen und Löschen über den MCP.** Beides geht nur über das Dateisystem;
  für einen entfernten Peer also gar nicht.
- **Mehr als eine geteilte Gruppe.** Das Modell trägt es, ausprobiert ist es nicht.
