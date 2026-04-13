# Social LLM Wiki — Konzept

Dezentrales, soziales Wiki für Menschen + LLM-Agenten.  
Gemeinsam kuratiert, ohne zentralen Server.

---

## Vision

Jeder Mensch hat einen persönlichen Wiki-Bereich, kuratiert durch seinen eigenen LLM-Agenten.
Bots und Menschen können gemeinsame Bereiche kollaborativ bearbeiten — konfliktfrei via CRDTs,
verteilt via libp2p. Neue Inhalte fließen über offene Channels rein: Textnachrichten, GPS-Tracks,
Fotos, Kalendereinträge, beliebige strukturierte Daten.

---

## Technologie-Stack

| Schicht          | Technologie                              |
|------------------|------------------------------------------|
| Identität        | DIDs (Decentralized Identifiers)         |
| Auth             | UCAN (User Controlled Authorization)     |
| Sync             | Yjs (CRDT) + libp2p GossipSub            |
| LLM-Layer        | Karpathy ingest/maintain pattern         |
| Bot-Koordination | A2A protocol                             |
| Visualisierung   | Quartz (persönlich) + Outline (shared)   |
| Suche            | Meilisearch                              |
| Hardware         | Raspberry Pi 5, Mac Mini M5 (2026 H2)   |

---

## Wiki-Namespaces

Jeder Nutzer und jede Gruppe hat einen eigenen Namespace.
Namespaces sind separate Yjs-Dokument-Scopes mit eigenen Berechtigungen.

```
wiki/
  @darius/            ← Persönlicher Wiki (Kai ist LLM-Kurator)
    reisen/
    notizen/
    projekte/
  @soenke/            ← Persönlicher Wiki (Horst Duda ist LLM-Kurator)
    ...
  groups/
    hiking/           ← Geteilte Wandergruppe (beide schreibend)
    projekte/         ← Gemeinsame Projekte
    ...
```

Schreibrechte pro Namespace:
- `@darius/` → nur Darius + Kai
- `@soenke/` → nur Sönke + Horst Duda
- `groups/*` → alle Mitglieder der Gruppe (via UCAN-Delegation)

**Phase 1** (vor UCAN): einfache Namespace-Strings + Yjs-Docs pro Namespace genügen.
UCAN kommt rein, sobald das System wirklich verteilt mit mehreren Personen läuft.

---

## Channel-Architektur

Channels sind die Eingabe-Wege ins Wiki.
Jeder Channel normalisiert seine Eingabe zu einem **ChannelEvent**,
das der LLM-Layer in Wiki-Seiten überführt.

```
Quelle → Channel → ChannelEvent → LLM-Layer → Wiki-Seite(n)
```

### ChannelEvent — gemeinsames Format

```js
{
  id:        'uuid',
  channel:   'gpx-import',        // welcher Channel
  schema:    'geo/track',          // Datentyp (hierarchisch)
  author:    'did:key:z...',       // Urheber (DID)
  namespace: '@darius/reisen',     // Ziel-Namespace im Wiki
  timestamp: '2026-04-12T10:00Z',
  tags:      ['wandern', 'zugspitze'],

  payload: {
    raw:  Buffer,                  // Rohdaten (GPX, Text, Foto, ...)
    mime: 'application/gpx+xml',
    meta: { ... }                  // schemaspezifische Metadaten
  }
}
```

### Channel-Typen

**Push** — Daten kommen zum System:
- Matrix-Nachrichten (Kai/Horst Duda als primäres Interface)
- Watched Folder / Datei-Drop
- Webhook (Shortcuts, n8n, IFTTT)
- CLI (`wiki add "..."`)

**Pull** — System holt Daten:
- GPS-Tracks vom Gerät (Garmin, Telefon)
- RSS/Atom Feeds
- Kalender (iCal)
- APIs (Wetter, Strava, OSM, ...)

**Interaktiv** — Konversation als Channel:
- Kai-Bot (Darius)
- Horst Duda (Sönke)

### Schema-Hierarchie

```
channels/
  text/
    note          — Freie Notiz, Matrix-Nachricht
    transcript    — Voice-Memo → Transkript
    article       — Web-Clip, RSS-Artikel
  geo/
    track         — GPX/FIT Wanderroute, Reise
    poi           — Ort, Restaurant, Hütte
    photo         — Foto mit EXIF-Geodaten
  media/
    photo         — Foto ohne Geo
    audio         — Voice-Memo (roh)
  structured/
    ical          — Kalender-Event
    rss           — Feed-Artikel
  raw/
    url           — URL (Web-Clip)
    file          — beliebige Datei
```

Neuen Channel hinzufügen = neues Schema registrieren + LLM-Prompt für diesen Typ.
Das System ist damit offen für beliebige zukünftige Datenquellen.

### Beispiel: GPX-Track einer Wanderung

Ein Channel nimmt eine GPX-Datei entgegen. Der LLM-Layer generiert daraus:

```markdown
---
title: Zugspitze via Höllental — 2026-04-10
schema: geo/track
tags: [wandern, zugspitze, alpen]
geo:
  start: [47.421, 10.985]
  distance_km: 18.4
  elevation_m: 2962
  gpx: reisen/tracks/2026-zugspitze.gpx
---

# Zugspitze via Höllental

**18,4 km · 2962 Hm · 9h**

KI-generierte Zusammenfassung: Wetter, Highlights, Schwierigkeitsgrad...

## Wegpunkte
...

## Verlinkung
- [[alpen-touren-übersicht]]
- [[hütten/münchner-haus]]
```

---

## LLM-Layer: ingest / maintain

Nach dem Karpathy-Muster gibt es zwei Operationen:

- **ingest** — Rohmaterial → neue Wiki-Seite(n)
  - LLM strukturiert, extrahiert, verlinkt
  - Entscheidet: neue Seite oder bestehende ergänzen?

- **maintain** — Bestehende Seite aktualisieren
  - Neue Infos einfügen, Konflikte auflösen
  - Qualitätssicherung (Links prüfen, Dopplungen entfernen)
  - Läuft periodisch oder getriggert

Bots (Kai, Horst Duda) führen beide Operationen aus und koordinieren sich via A2A-Protokoll
wenn sie an gemeinsamen Namespaces arbeiten.

---

## Bot-Koordination (A2A)

```
Kai  ←──A2A──→  Horst Duda
 │                   │
 ▼                   ▼
@darius/         @soenke/
          ↘ ↙
        groups/hiking/
```

Wenn beide Bots auf `groups/hiking/` schreiben:
1. Jeder Bot sendet ein Yjs-Update via GossipSub
2. CRDTs lösen Merge automatisch auf
3. Bei semantischen Konflikten (gleiche Seite, widersprüchliche Aussagen):
   → A2A-Nachricht an den anderen Bot → gemeinsame Auflösung

---

## Offene Fragen (für Diskussion mit Sönke)

- **A2A + libp2p**: Läuft A2A direkt über libp2p-Streams oder als eigene Schicht drüber?
- **UCAN Scope**: Für Phase 1 UCAN weglassen und einfaches Keypair-basiertes Auth nutzen?
- **GossipSub Topics**: Ein Topic pro Namespace oder ein globales Topic mit Namespace-Filter?
- **Bot-Identität**: Ein DID pro Bot oder ein DID pro (Bot × Namespace)?
- **Maintain-Trigger**: Periodisch (Cron), event-getriggert oder beides?
- **Visualisierung**: Quartz für persönlich OK — was für den shared-Layer? Outline oder etwas anderes?

---

## Memory-Architektur

Das Wiki unterscheidet zwischen Kurzzeitgedächtnis (`inbox/`), Staging (`review/`) und
Langzeitgedächtnis (`wiki/`). Auto-Ingest-Channels füllen die Inbox automatisch;
ein LLM-Review-Schritt schlägt Promotionen vor; der Nutzer entscheidet, was dauerhaft ins Wiki kommt.

→ Details: [memory-architecture.md](memory-architecture.md)

---

## Implementierungs-Reihenfolge (Vorschlag)

1. ✅ PoC: Yjs + libp2p GossipSub Sync (fertig)
2. DID-Schema für Kai + Horst Duda
3. Namespace-Model + Yjs-Docs pro Namespace
4. Inbox-Struktur + TTL-Mechanismus
5. Erster Auto-Ingest-Channel: `email-imap`
6. LLM-Review-Schritt: Kai analysiert Inbox, schreibt Kandidaten nach `review/`
7. User-Supervision: Matrix-Notification + Approve/Reject
8. Erster Geo-Channel: `geo/track` (GPX)
9. A2A-Protokoll zwischen Kai und Horst Duda
10. UCAN-Berechtigungen (wenn Multi-User live geht)
