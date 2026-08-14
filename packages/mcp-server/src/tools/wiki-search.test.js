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
