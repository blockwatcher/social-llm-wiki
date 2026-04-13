import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'

const EXCERPT_RADIUS = 120  // Zeichen vor/nach dem Treffer
const MAX_RESULTS = 10

/**
 * wiki_search — Full-text search across wiki pages
 *
 * Searches all Markdown pages in the wiki (optionally restricted
 * to a namespace) and returns matching pages with context excerpts.
 */
export async function wikiSearch({ wikiRoot, query, namespace = '' }) {
  const base = join(wikiRoot, namespace)

  if (!existsSync(base)) {
    return { content: [{ type: 'text', text: `Namespace not found: ${namespace}` }] }
  }

  const pages = await collectPages(base, base)
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

    results.push({ relPath, excerpt, count })
    if (results.length >= MAX_RESULTS) break
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No results for "${query}"${namespace ? ` in ${namespace}` : ''}.` }] }
  }

  const lines = [
    `## Search results for "${query}"${namespace ? ` (${namespace})` : ''}`,
    `_${results.length} match(es)_`,
    '',
  ]

  for (const r of results.sort((a, b) => b.count - a.count)) {
    lines.push(`### ${r.relPath} _(${r.count}×)_`)
    lines.push(`> ${r.excerpt}`)
    lines.push('')
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
