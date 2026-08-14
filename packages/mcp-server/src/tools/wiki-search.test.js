/**
 * Regressionstest für wiki_search — läuft mit `node --test` (keine Abhängigkeit).
 *
 * Bewacht wird ein Fehler, der sich leicht wieder einschleicht: die Ergebnisse
 * wurden früher bei MAX_RESULTS abgeschnitten und ERST DANACH sortiert.
 * Genommen wurde damit, was in der Verzeichnisreihenfolge zuerst kam — und
 * `pages/` steht alphabetisch hinter `_sources/` und `inbox/`. In einer echten
 * Wiki füllten die Rohdaten alle zehn Plätze, die zuständigen Projektseiten
 * fielen heraus. Die Suche lieferte also 10 von 18 Treffern, und zwar die
 * falschen 10.
 *
 * Wer das `break` aus Effizienzgründen wieder einbaut, lässt diesen Test fallen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { wikiSearch } from './wiki-search.js'

async function buildWiki() {
  const root = await mkdtemp(join(tmpdir(), 'wiki-search-test-'))
  await mkdir(join(root, 'pages', 'projekte'), { recursive: true })
  await mkdir(join(root, 'inbox', 'sessions'), { recursive: true })
  await mkdir(join(root, '_sources'), { recursive: true })

  // Kuratierte Seite: nennt den Begriff dreimal.
  await writeFile(join(root, 'pages', 'projekte', 'wallbox.md'),
    'Die Wallbox ist eine go-e. Die go-e haengt am Netz. Anschluss der go-e: 11 kW.\n')

  // Zwölf Rohdateien, jede mit MEHR Treffern als die kuratierte Seite. Zwölf,
  // damit sie MAX_RESULTS (10) allein fuellen wuerden.
  for (let i = 0; i < 12; i++) {
    await writeFile(join(root, 'inbox', 'sessions', `2026-01-${String(i + 1).padStart(2, '0')}.md`),
      'go-e '.repeat(20))
  }
  await writeFile(join(root, '_sources', 'rohnotiz.md'), 'go-e '.repeat(30))
  return root
}

test('kuratierte Seite ueberlebt die Kuerzung auf MAX_RESULTS', async (t) => {
  const root = await buildWiki()
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'go-e' })).content[0].text

  assert.ok(out.includes('pages/projekte/wallbox.md'),
    'die kuratierte Seite fehlt im Ergebnis — vermutlich wieder vor dem Sortieren gekuerzt')

  const zeilen = out.split('\n').filter((l) => l.startsWith('### '))
  assert.equal(zeilen[0].includes('pages/projekte/wallbox.md'), true,
    `kuratierte Seite steht nicht an erster Stelle, sondern: ${zeilen[0]}`)
})

test('Gesamtzahl wird genannt, nicht nur die gezeigten', async (t) => {
  const root = await buildWiki()
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'go-e' })).content[0].text
  // 14 Dateien enthalten den Begriff, gezeigt werden 10.
  assert.match(out, /14 match\(es\), showing top 10/,
    'eine gekuerzte Liste darf sich nicht wie eine vollstaendige lesen')
  assert.match(out, /and 4 more/)
})

test('namespace grenzt auf kuratierte Seiten ein', async (t) => {
  const root = await buildWiki()
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'go-e', namespace: 'pages' })).content[0].text
  assert.ok(out.includes('pages/projekte/wallbox.md'))
  assert.ok(!out.includes('inbox/'), 'namespace-Filter hat Rohdaten durchgelassen')
})

// ── BM25-Eigenschaften ──────────────────────────────────────────────────────

async function wikiWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-bm25-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, body)
  }
  return root
}

test('Wortgrenzen: "soc" trifft nicht "social"', async (t) => {
  const root = await wikiWith({
    'pages/a.md': 'Der SoC des Akkus liegt bei 80 Prozent.\n',
    'pages/b.md': 'social social social social social\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'soc' })).content[0].text
  assert.ok(out.includes('pages/a.md'))
  assert.ok(!out.includes('pages/b.md'),
    '"soc" darf nicht innerhalb von "social" treffen — Teilstring statt Wortgrenze')
})

test('Saettigung: langes Wiederholen schlaegt die kuratierte Seite nicht mehr', async (t) => {
  // Der Fall aus der Praxis: ein Sitzungsmitschnitt nennt den Begriff 80-mal,
  // die zustaendige Seite dreimal. Nach roher Trefferzahl gewann der Mitschnitt.
  //
  // BM25 allein dreht das NICHT um — 80 Vorkommen bleiben mehr als 3, die
  // Saettigung daempft nur das Verhaeltnis (aus 80:1 wird rechnerisch etwa
  // 1,3:1). Erst zusammen mit dem Fundort-Gewicht kippt es. Beides gehoert
  // deshalb zusammen; wer eines davon entfernt, faellt in das alte Verhalten
  // zurueck.
  const root = await wikiWith({
    'pages/wallbox.md': 'Die Wallbox laedt den Wagen. Die Wallbox haengt am Netz. Wallbox: 11 kW.\n',
    'inbox/sessions/dump.md': 'wallbox '.repeat(80) + 'fuellwort '.repeat(4000) + '\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'wallbox' })).content[0].text
  const erste = out.split('\n').filter((l) => l.startsWith('### '))[0]
  assert.ok(erste.includes('pages/wallbox.md'),
    `der Mitschnitt gewinnt noch immer: ${erste}`)
})

test('Wortmengen-Anfrage: Frage findet Seiten mit einem Teil der Begriffe', async (t) => {
  const root = await wikiWith({
    'pages/laden.md': 'Nachts laedt der Wagen guenstig.\n',
    'pages/anderes.md': 'Ein Text ueber Pilze.\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'Warum laedt der Wagen nachts' })).content[0].text
  assert.ok(!out.startsWith('No results'),
    'eine Frage darf nicht als Phrase gesucht werden — sonst null Treffer')
  assert.ok(out.includes('pages/laden.md'))
  assert.ok(!out.includes('pages/anderes.md'))
})

test('Fuellwoerter fliegen raus, solange etwas uebrig bleibt', async (t) => {
  const root = await wikiWith({
    'pages/a.md': 'das Thema ist Photovoltaik\n',
    'pages/b.md': 'das ist etwas ganz anderes\n',
    'pages/c.md': 'das kommt ueberall vor\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'das Photovoltaik' })).content[0].text
  assert.match(out, /Terms: photovoltaik/,
    '"das" steht in allen Seiten und darf die Trefferliste nicht fuellen')
  assert.ok(!out.includes('pages/b.md'))
})

// ── Feld-Gewichtung und Morphologie ─────────────────────────────────────────

test('Titel wiegt schwerer als Fliesstext', async (t) => {
  const root = await wikiWith({
    'pages/thema.md': '---\ntitle: Wallbox\ncategory: technik\n---\n\nAnschluss und Montage.\n',
    'pages/nebenbei.md': '---\ntitle: Hausanschluss\n---\n\n' + 'Die wallbox wird erwaehnt. '.repeat(12),
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'wallbox' })).content[0].text
  const erste = out.split('\n').filter((l) => l.startsWith('### '))[0]
  assert.ok(erste.includes('pages/thema.md'),
    `die Seite, die das Thema IST, steht nicht oben: ${erste}`)
})

test('aliases machen eine Seite unter ihrem Alltagsnamen auffindbar', async (t) => {
  const root = await wikiWith({
    'pages/id3.md': '---\ntitle: VW ID.3\naliases: [Auto, Stromer]\n---\n\nReichweite und Laden.\n',
    'pages/sonst.md': '---\ntitle: Sonstiges\n---\n\nHier steht nichts dazu.\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'Stromer' })).content[0].text
  assert.ok(out.includes('pages/id3.md'),
    'ein Alias im Frontmatter muss die Seite auffindbar machen')
})

test('Beugung und Komposita zaehlen mit, schwaecher', async (t) => {
  // Nachgebaut nach dem realen Fall: die Fachseite nennt fast nur gebeugte
  // Formen, die beilaeufige Seite genau einmal die Grundform.
  const root = await wikiWith({
    'pages/fach.md': '---\ntitle: Schall\n---\n\n'
      + 'Waermepumpen sind laut. Waermepumpen-Laerm, Waermepumpen-Studien, '
      + 'Waermepumpen im Betrieb, Waermepumpen-Genehmigung.\n',
    'pages/beilaeufig.md': '---\ntitle: Kaufberatung\n---\n\nKeine Waermepumpe verbaut.\n',
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'Waermepumpe' })).content[0].text
  assert.ok(out.includes('pages/fach.md'),
    'Plural und Kompositum duerfen nicht durchfallen — genau das war der Fehler')
  const erste = out.split('\n').filter((l) => l.startsWith('### '))[0]
  assert.ok(erste.includes('pages/fach.md'),
    `die Fachseite steht nicht oben: ${erste}`)
})

test('kurze Begriffe greifen NICHT auf laengere Woerter', async (t) => {
  const root = await wikiWith({
    'pages/a.md': '---\ntitle: Fahrzeug\n---\n\nDas auto steht draussen.\n',
    'pages/b.md': '---\ntitle: Ablauf\n---\n\n' + 'automatisch '.repeat(30),
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const out = (await wikiSearch({ wikiRoot: root, query: 'auto' })).content[0].text
  assert.ok(out.includes('pages/a.md'))
  assert.ok(!out.includes('pages/b.md'),
    '"auto" darf nicht auf "automatisch" greifen — MIN_STEM_LEN schuetzt davor')
})
