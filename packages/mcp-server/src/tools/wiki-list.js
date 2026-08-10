import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { resolveInsideWiki, outsideRootError } from '../safe-path.js'

/**
 * wiki_list — List all pages in a namespace
 *
 * Returns a file tree with the title of each page.
 */
export async function wikiList({ wikiRoot, namespace = '', subpath = '' }) {
  const base = resolveInsideWiki(wikiRoot, namespace, subpath)

  if (!base) {
    return outsideRootError(`${namespace}/${subpath}`)
  }

  if (!existsSync(base)) {
    return { content: [{ type: 'text', text: `Namespace/path not found: ${namespace}/${subpath}` }] }
  }

  // Paths are reported relative to the wiki root, not to `base`, so that what
  // this returns can be handed to wiki_read unchanged.
  const pages = await collectPages(base, resolve(wikiRoot))

  if (pages.length === 0) {
    return { content: [{ type: 'text', text: `No pages found in ${namespace}/${subpath}` }] }
  }

  const lines = [
    `## Wiki — ${namespace || 'all'}${subpath ? '/' + subpath : ''}`,
    `_${pages.length} page(s)_`,
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
