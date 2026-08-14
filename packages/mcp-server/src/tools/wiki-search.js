import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { resolveInsideWiki, outsideRootError } from '../safe-path.js'

const EXCERPT_RADIUS = 120  // Zeichen vor/nach dem Treffer
const MAX_RESULTS = 10

// BM25-Parameter. k1 steuert, wie schnell der Nutzen weiterer Vorkommen
// abflacht; b, wie stark lange Dokumente heruntergewichtet werden. 1.5/0.75
// sind die üblichen Werte und für einen Korpus dieser Größe unkritisch.
const K1 = 1.5
const B = 0.75

// Kleiner Zuschlag, wenn die Anfrage zusätzlich als zusammenhängende
// Zeichenfolge vorkommt. Hilft bei Bezeichnern wie `min_soc_percentage` oder
// `sensor.s10e_state_of_charge`, die als Ganzes gemeint sind.
const PHRASE_BONUS = 1.25

// Ab welchem Dokumentanteil ein Wort als Füllwort gilt. 0,5 = kommt in mehr als
// der Hälfte aller Seiten vor.
const STOPWORD_DF_RATIO = 0.5

/**
 * Gewicht nach Fundort. Die Wiki trennt kuratiertes Wissen (`pages/`) von
 * Rohmaterial (`_sources/`, `inbox/`).
 *
 * Bewusst ein Faktor und keine harte Sortierstufe: sonst schlägt eine Seite mit
 * einem beiläufigen Treffer jede Quelle mit fünfzig. Der Faktor drückt eine
 * Vorliebe aus, kein Verbot.
 */
const TIER_WEIGHT = { pages: 1.0, root: 0.8, sources: 0.6, inbox: 0.45 }

function tierWeight(relPath) {
  if (relPath.startsWith('pages/')) return TIER_WEIGHT.pages
  if (relPath.startsWith('_sources/')) return TIER_WEIGHT.sources
  if (relPath.startsWith('inbox/')) return TIER_WEIGHT.inbox
  return TIER_WEIGHT.root   // log.md, wiki-index.md, SCHEMA.md
}

/**
 * Zerlegung in Wörter. Bindestrich und Unterstrich bleiben **im** Token, damit
 * `go-e` und `min_soc` nicht auseinanderfallen — das sind hier die typischen
 * Suchbegriffe. `\p{L}` statt `a-z`, sonst zerbrechen Umlaute.
 */
function tokenize(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
}

/**
 * wiki_search — Volltextsuche über die Wiki-Seiten, BM25-gerankt.
 *
 * Die Anfrage wird als **Wortmenge** behandelt, nicht als Phrase: eine Frage
 * zerfällt in ihre Begriffe, jeder trägt zum Rang bei. Vorher war es ein
 * `indexOf` auf die gesamte Zeichenfolge — „Warum lädt das Auto nachts" fand
 * damit nichts, obwohl jedes einzelne Wort in der Wiki steht.
 */
export async function wikiSearch({ wikiRoot, query, namespace = '' }) {
  const base = resolveInsideWiki(wikiRoot, namespace)

  if (!base) {
    return outsideRootError(namespace)
  }

  if (!existsSync(base)) {
    return { content: [{ type: 'text', text: `Namespace not found: ${namespace}` }] }
  }

  // Pfade werden relativ zur Wiki-Wurzel gemeldet, nicht zu `base`, damit
  // Treffer unverändert an wiki_read weitergereicht werden können.
  const pages = await collectPages(base, resolve(wikiRoot))
  if (pages.length === 0) {
    return { content: [{ type: 'text', text: `No pages under ${namespace || 'wiki root'}.` }] }
  }

  const queryLower = query.toLowerCase().trim()
  const terms = [...new Set(tokenize(queryLower))]
  if (terms.length === 0) {
    return { content: [{ type: 'text', text: `Empty query.` }] }
  }

  const docs = pages.map(({ relPath, content }) => {
    const tokens = tokenize(content)
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { relPath, content, lower: content.toLowerCase(), tf, len: tokens.length }
  })

  const N = docs.length
  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1

  // Je Suchbegriff: Dokumenthäufigkeit und IDF.
  //
  // Fällt ein Begriff als ganzes Wort nirgends, wird auf Teilstring
  // zurückgefallen. Das ist für Deutsch nötig — `Strommessung` steckt in
  // `Wärmepumpen-Strommessung`, das als ein Token gilt. Der Rückfall greift nur
  // bei sonst null Treffern, deshalb findet `soc` weiterhin nicht `social`.
  const scored = terms.map((term) => {
    let df = docs.reduce((n, d) => n + (d.tf.has(term) ? 1 : 0), 0)
    let substring = false
    if (df === 0) {
      df = docs.reduce((n, d) => n + (d.lower.includes(term) ? 1 : 0), 0)
      substring = df > 0
    }
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    return { term, df, idf, substring }
  }).filter((t) => t.df > 0)

  // Allgegenwärtige Wörter verwerfen, solange etwas übrig bleibt. IDF gewichtet
  // sie zwar schon gering, aber sie machen weiterhin jedes Dokument zu einem
  // „Treffer": bei „Warum lädt das Auto nachts" steht `das` in 52 % der Seiten
  // und blähte die Trefferzahl von ~90 auf 321. Eine Trefferzahl, die von einem
  // Füllwort getragen wird, sagt nichts — und liest sich trotzdem wie ein Fund.
  // Keine Stoppwortliste: die wäre sprachgebunden, der Schwellwert ist es nicht.
  const informative = scored.filter((t) => t.df / N <= STOPWORD_DF_RATIO)
  const termStats = informative.length > 0 ? informative : scored

  if (termStats.length === 0) {
    return { content: [{ type: 'text', text: `No results for "${query}"${namespace ? ` in ${namespace}` : ''}.` }] }
  }

  const results = []
  for (const doc of docs) {
    let score = 0
    let hits = 0
    let matched = 0
    for (const { term, idf, substring } of termStats) {
      const f = substring ? countSubstring(doc.lower, term) : (doc.tf.get(term) ?? 0)
      if (f === 0) continue
      matched++
      hits += f
      const norm = 1 - B + B * (doc.len / avgdl)
      score += idf * ((f * (K1 + 1)) / (f + K1 * norm))
    }
    if (matched === 0) continue

    if (terms.length > 1 && doc.lower.includes(queryLower)) score *= PHRASE_BONUS
    score *= tierWeight(doc.relPath)

    results.push({
      relPath: doc.relPath,
      excerpt: buildExcerpt(doc, termStats),
      hits,
      matched,
      score,
    })
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No results for "${query}"${namespace ? ` in ${namespace}` : ''}.` }] }
  }

  // Erst vollständig sammeln, dann sortieren, dann kürzen — in dieser
  // Reihenfolge. Vorher brach die Schleife bei MAX_RESULTS ab und sortierte
  // hinterher nur diese ersten zehn: genommen wurde also, was in der
  // Verzeichnisreihenfolge zuerst kam, und `pages/` steht alphabetisch hinter
  // `_sources/`, `inbox/` und `log.md`.
  results.sort((a, b) => b.score - a.score)
  const shown = results.slice(0, MAX_RESULTS)
  const more = results.length - shown.length

  const lines = [
    `## Search results for "${query}"${namespace ? ` (${namespace})` : ''}`,
    // Gesamtzahl nennen, nicht nur die gezeigten: sonst liest sich eine
    // gekürzte Liste wie eine vollständige.
    `_${results.length} match(es)${more > 0 ? `, showing top ${shown.length}` : ''}_`,
    '',
  ]

  if (terms.length > 1) {
    lines.push(`_Terms: ${termStats.map((t) => t.term).join(', ')}_`, '')
  }

  for (const r of shown) {
    const cover = terms.length > 1 ? `, ${r.matched}/${termStats.length} terms` : ''
    lines.push(`### ${r.relPath} _(${r.hits}×${cover})_`)
    lines.push(`> ${r.excerpt}`)
    lines.push('')
  }

  if (more > 0) {
    lines.push(`_… and ${more} more. Narrow with \`namespace\` (e.g. "pages") or a more specific query._`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

function countSubstring(haystack, needle) {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

/**
 * Auszug um den **aussagekräftigsten** Begriff, nicht um den erstbesten.
 *
 * Vorher wurde immer die erste Fundstelle gezeigt — bei Markdown-Seiten also
 * regelmäßig die `tags:`-Zeile im Frontmatter, weil dort alle Stichwörter
 * stehen. Formal ein Treffer, inhaltlich wertlos. Jetzt entscheidet der
 * seltenste Begriff (höchstes IDF), wo der Auszug beginnt.
 */
function buildExcerpt(doc, termStats) {
  let best = -1
  let bestIdf = -Infinity
  for (const { term, idf } of termStats) {
    const i = doc.lower.indexOf(term)
    if (i !== -1 && idf > bestIdf) {
      best = i
      bestIdf = idf
    }
  }
  if (best === -1) best = 0

  const start = Math.max(0, best - EXCERPT_RADIUS)
  const end = Math.min(doc.content.length, best + EXCERPT_RADIUS)
  return (start > 0 ? '…' : '') +
    doc.content.slice(start, end).replace(/\n/g, ' ') +
    (end < doc.content.length ? '…' : '')
}

async function collectPages(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectPages(full, base))
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(full, 'utf8')
      results.push({ relPath: relative(base, full), content })
    }
  }
  return results
}
