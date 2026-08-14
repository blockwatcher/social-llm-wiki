import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { resolveInsideWiki, outsideRootError } from '../safe-path.js'

const EXCERPT_RADIUS = 120  // Zeichen vor/nach dem Treffer
const MAX_RESULTS = 10

/**
 * Rangstufe eines Fundorts. Niedriger = wichtiger.
 *
 * Die Wiki trennt kuratiertes Wissen (`pages/`) von Rohmaterial (`_sources/`,
 * `inbox/`). Ohne diese Stufen gewinnt bei häufigen Begriffen fast immer ein
 * Gesprächsmitschnitt: die sind lang und wiederholen sich, während die
 * kuratierte Seite dieselbe Sache einmal sauber sagt. Gemessen an einer echten
 * Wiki brachte "go-e" 36 Treffer in einem Sitzungsmitschnitt gegen 18 auf der
 * zuständigen Projektseite — nach reiner Trefferzahl also die falsche Antwort
 * zuerst.
 */
function tier(relPath) {
  if (relPath.startsWith('pages/')) return 0
  if (relPath.startsWith('_sources/')) return 2
  if (relPath.startsWith('inbox/')) return 3
  return 1   // log.md, wiki-index.md, SCHEMA.md — kuratiert, aber keine Inhaltsseiten
}

/**
 * wiki_search — Full-text search across wiki pages
 *
 * Searches all Markdown pages in the wiki (optionally restricted
 * to a namespace) and returns matching pages with context excerpts.
 */
export async function wikiSearch({ wikiRoot, query, namespace = '' }) {
  const base = resolveInsideWiki(wikiRoot, namespace)

  if (!base) {
    return outsideRootError(namespace)
  }

  if (!existsSync(base)) {
    return { content: [{ type: 'text', text: `Namespace not found: ${namespace}` }] }
  }

  // Paths are reported relative to the wiki root, not to `base`, so that hits
  // can be handed to wiki_read unchanged.
  const pages = await collectPages(base, resolve(wikiRoot))
  const queryLower = query.toLowerCase()
  const results = []

  for (const { relPath, content } of pages) {
    const contentLower = content.toLowerCase()
    const idx = contentLower.indexOf(queryLower)
    if (idx === -1) continue

    const start = Math.max(0, idx - EXCERPT_RADIUS)
    const end = Math.min(content.length, idx + query.length + EXCERPT_RADIUS)
    const excerpt = (start > 0 ? '…' : '') +
      content.slice(start, end).replace(/\n/g, ' ') +
      (end < content.length ? '…' : '')

    // Treffer zählen
    const count = [...contentLower.matchAll(new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length

    results.push({ relPath, excerpt, count, tier: tier(relPath) })
  }

  // Erst vollständig sammeln, dann sortieren, dann kürzen — in dieser
  // Reihenfolge. Vorher brach die Schleife bei MAX_RESULTS ab und sortierte
  // hinterher nur diese ersten zehn: genommen wurde also, was in der
  // Verzeichnisreihenfolge zuerst kam, und `pages/` steht alphabetisch hinter
  // `_sources/`, `inbox/` und `log.md`. Bei "go-e" füllten diese drei alle zehn
  // Plätze, die drei zuständigen Projektseiten landeten auf 11–13 und fielen
  // weg — die Suche lieferte 10 von 18 Treffern, und zwar die falschen 10.
  results.sort((a, b) => a.tier - b.tier || b.count - a.count)
  const shown = results.slice(0, MAX_RESULTS)

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No results for "${query}"${namespace ? ` in ${namespace}` : ''}.` }] }
  }

  const more = results.length - shown.length
  const lines = [
    `## Search results for "${query}"${namespace ? ` (${namespace})` : ''}`,
    // Gesamtzahl nennen, nicht nur die gezeigten: sonst liest sich eine
    // gekürzte Liste wie eine vollständige.
    `_${results.length} match(es)${more > 0 ? `, showing top ${shown.length}` : ''}_`,
    '',
  ]

  for (const r of shown) {
    lines.push(`### ${r.relPath} _(${r.count}×)_`)
    lines.push(`> ${r.excerpt}`)
    lines.push('')
  }

  if (more > 0) {
    lines.push(`_… and ${more} more. Narrow with \`namespace\` (e.g. "pages") or a more specific query._`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
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
