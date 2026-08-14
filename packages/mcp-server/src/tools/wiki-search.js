import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { resolveInsideWiki, outsideRootError } from '../safe-path.js'

const EXCERPT_RADIUS = 120  // Zeichen vor/nach dem Treffer
const MAX_RESULTS = 10

// BM25-Parameter. k1 steuert, wie schnell der Nutzen weiterer Vorkommen
// abflacht; b, wie stark lange Dokumente heruntergewichtet werden.
//
// b liegt bewusst unter dem üblichen 0.75. Der Standardwert unterstellt, dass
// Länge vor allem Füllstoff bedeutet — in einer Wiki ist das umgekehrt: die
// langen Seiten sind die gründlich recherchierten. Gemessen an diesem Korpus
// (935 bis 16.046 Token) gewann bei 0.75 für „Wärmepumpe" eine Seite mit einem
// einzigen beiläufigen Treffer („kein Wärmepumpe") gegen die Fachseite mit
// neun. Ab 0.5 kippt es richtig herum; darunter ändert sich nichts mehr.
const K1 = 1.5
const B = 0.5

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

// Ein Treffer im Titel wiegt schwerer als einer im Fließtext, einer in den
// Aliasen fast ebenso. Beide stehen genau einmal in der Datei; ohne Zuschlag
// gingen sie in einer Seite unter, die den Begriff beiläufig zwanzigmal
// erwähnt. Mit k1 = 1.5 verdoppelt ein Faktor von 8 den Beitrag des Begriffs
// ungefähr — deutlich, aber nicht erdrückend.
const TITLE_BOOST = 8
const ALIAS_BOOST = 6

/**
 * Zerlegung in Wörter. Bindestrich und Unterstrich bleiben **im** Token, damit
 * `go-e` und `min_soc` nicht auseinanderfallen — das sind hier die typischen
 * Suchbegriffe. `\p{L}` statt `a-z`, sonst zerbrechen Umlaute.
 */
function tokenize(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
}

/**
 * `title` und `aliases` aus dem YAML-Frontmatter ziehen.
 *
 * Bewusst per Regex statt mit einem YAML-Parser: das wären eine Abhängigkeit
 * und ein Fehlerpfad für eine Suche, die auch bei kaputtem Frontmatter noch
 * etwas liefern soll. Wird nichts erkannt, gibt es eben keinen Zuschlag.
 */
// Beugungsformen zählen mit, aber schwächer. Deutsch hängt an: aus
// `Wärmepumpe` wird `Wärmepumpen`, `Wärmepumpen-Verbrauch`,
// `Wärmepumpenkomponenten`. Reine Wortgleichheit übersieht das — auf einer
// Fachseite standen 6 exakte Treffer neben 14 Formen, die durchfielen.
//
// Deshalb gilt ein Dokument-Token auch dann als Treffer, wenn es mit dem
// Suchbegriff beginnt und
//   * höchstens INFLECTION_MAX_SUFFIX Zeichen anhängt (Plural, Kasus), oder
//   * direkt danach einen Bindestrich setzt (Kompositum).
// Beides nur ab MIN_STEM_LEN Zeichen, sonst würde `auto` auf `automatisch`
// und `Autor` greifen — genau die Unschärfe, die die Wortgrenzen beseitigt
// haben.
const INFLECTION_WEIGHT = 0.5
const INFLECTION_MAX_SUFFIX = 3
const MIN_STEM_LEN = 5

function matchWeight(token, term) {
  if (token === term) return 1
  if (term.length < MIN_STEM_LEN || !token.startsWith(term)) return 0
  const rest = token.slice(term.length)

  // Beugung: `Wärmepumpe` → `Wärmepumpen`, `Akku` → `Akkus`.
  if (rest.length <= INFLECTION_MAX_SUFFIX) return INFLECTION_WEIGHT

  // Kompositum mit Bindestrich. Der Strich steht selten direkt hinter dem
  // Wort — Deutsch schiebt ein Fugenelement ein: `Wärmepumpe` + `n` +
  // `-Lärm`. Ein erstes Muster verlangte den Strich unmittelbar danach und
  // erwischte deshalb kein einziges Kompositum.
  if (new RegExp(`^.{0,${INFLECTION_MAX_SUFFIX}}-`).test(rest)) return INFLECTION_WEIGHT

  // Zusammengeschriebene Komposita (`Wärmepumpenkomponenten`) bleiben
  // unerkannt. Sie zu erfassen hieße, beliebig lange Endungen zuzulassen —
  // und damit `auto` wieder auf `automatisch` greifen zu lassen. Ohne
  // Wörterbuch ist das die richtige Seite, auf der man irrt.
  return 0
}

function frontmatterFields(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { title: '', aliases: '' }
  const block = m[1]
  const title = (block.match(/^title:\s*(.+)$/m)?.[1] ?? '').replace(/^["']|["']$/g, '')
  // `aliases: [a, b]` und die Listenform mit `- a` je Zeile abdecken.
  const inline = block.match(/^aliases:\s*\[(.*?)\]/m)?.[1] ?? ''
  const listed = (block.match(/^aliases:\s*\n((?:\s*-\s*.+\n?)+)/m)?.[1] ?? '')
  return { title, aliases: `${inline} ${listed}` }
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

    // Feld-Zuschlag. Titel und Aliase stecken bereits im Text und sind oben
    // einmal gezählt; hier kommt die Differenz zum Zielgewicht dazu. Die
    // Dokumentlänge bleibt die des tatsächlichen Textes — sonst würde die
    // Längennormierung den Zuschlag gleich wieder auffressen.
    const { title, aliases } = frontmatterFields(content)
    for (const [text, boost] of [[title, TITLE_BOOST], [aliases, ALIAS_BOOST]]) {
      for (const t of tokenize(text)) {
        tf.set(t, (tf.get(t) ?? 0) + (boost - 1))
      }
    }

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
  // Einmal das Vokabular, dann je Begriff die passenden Token samt Gewicht.
  // Ohne diesen Zwischenschritt müsste je Begriff und Dokument die ganze
  // Token-Tabelle durchlaufen werden.
  const vocab = new Set()
  for (const d of docs) for (const t of d.tf.keys()) vocab.add(t)

  const scored = terms.map((term) => {
    const matches = []
    for (const token of vocab) {
      const w = matchWeight(token, term)
      if (w > 0) matches.push([token, w])
    }

    let df = docs.reduce((n, d) => n + (matches.some(([tok]) => d.tf.has(tok)) ? 1 : 0), 0)
    let substring = false
    if (df === 0) {
      // Letzter Ausweg: Teilstring irgendwo im Text. Greift nur, wenn der
      // Begriff als Wort und als Beugungsform nirgends vorkommt.
      df = docs.reduce((n, d) => n + (d.lower.includes(term) ? 1 : 0), 0)
      substring = df > 0
    }
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    return { term, df, idf, substring, matches }
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
    for (const { term, idf, substring, matches } of termStats) {
      const f = substring
        ? countSubstring(doc.lower, term)
        : (matches ?? []).reduce((s, [tok, w]) => s + (doc.tf.get(tok) ?? 0) * w, 0)
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
