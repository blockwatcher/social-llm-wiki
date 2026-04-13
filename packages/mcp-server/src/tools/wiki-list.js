import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * wiki_list — Seiten eines Namespace auflisten
 *
 * Gibt Dateibaum + Titel jeder Seite zurück.
 */
export async function wikiList({ wikiRoot, namespace = '', subpath = '' }) {
  const base = join(wikiRoot, namespace, subpath)

  if (!existsSync(base)) {
    return { content: [{ type: 'text', text: `Namespace/Pfad nicht gefunden: ${namespace}/${subpath}` }] }
  }

  const pages = await collectPages(base, base)

  if (pages.length === 0) {
    return { content: [{ type: 'text', text: `Keine Seiten in ${namespace}/${subpath}` }] }
  }

  const lines = [
    `## Wiki — ${namespace || 'alle'}${subpath ? '/' + subpath : ''}`,
    `_${pages.length} Seite(n)_`,
    '',
  ]

  for (const p of pages.sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    lines.push(`- **${p.relPath}** — ${p.title}`)
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
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const frontTitle = content.match(/^title:\s*(.+)$/m)
      const title = frontTitle?.[1] ?? titleMatch?.[1] ?? entry.name.replace('.md', '')
      results.push({ relPath: relative(base, full), title })
    }
  }
  return results
}
