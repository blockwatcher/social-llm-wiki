/**
 * Publish policy for shared groups: never let a private page's name leave the Pi.
 *
 * A page under pages/social/<group>/ is replicated to every peer of that group. A
 * [[wikilink]] pointing at a page that lives elsewhere in the wiki therefore does two
 * bad things: it dangles on the peer's side, and it discloses the private page's name.
 * Such references belong in the text as plain names.
 *
 * This is the last of three checkpoints for the same rule, and the only one that sees
 * every writer at the moment publication actually happens:
 *
 *   1. wiki_write_page (MCP)  — refuses at authoring time, for MCP clients only
 *   2. wiki-lint.py           — reports weekly, for every writer, after the fact
 *   3. here                   — refuses at publish time, for every writer
 *
 * Link resolution mirrors wiki-lint.py (exact filename stem, else slugified title,
 * umlauts transliterated) so the three never disagree about what a link points at.
 *
 * A target that resolves nowhere is allowed through: it leaks no existing page name,
 * and it may simply not be written yet. wiki-lint reports it as a broken link.
 */

import { readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g
const UMLAUTS = { ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Index every page under `pagesRoot` by filename stem → absolute paths. */
async function indexPageStems(pagesRoot) {
  const index = new Map()
  const stack = [pagesRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.md')) {
        const stem = entry.name.slice(0, -3)
        if (!index.has(stem)) index.set(stem, [])
        index.get(stem).push(full)
      }
    }
  }
  return index
}

/**
 * Build the publish gate for one shared group.
 *
 * @param {object}  opts
 * @param {string}  opts.pagesRoot  Root of the whole wiki's `pages/` tree — needed to
 *                                  tell a private page apart from a link that resolves
 *                                  nowhere. When it holds nothing outside the group
 *                                  (a peer's machine), the gate simply never fires.
 * @param {string}  opts.groupDir   The synced group directory.
 * @returns {(key: string, content: string) => Promise<string|null>}
 *          Reason the page must not be published, or null when it may go out.
 */
export function createLinkPolicy({ pagesRoot, groupDir }) {
  // The index is rebuilt per check: pages come and go while the node runs, and a stale
  // index would either leak a newly-created private page or block a link to a page that
  // has since moved into the group. A readdir walk over a few hundred entries is far
  // cheaper than getting this wrong.
  return async function gate(key, content) {
    if (!content.includes('[[')) return null // fast path: no links at all

    const targets = new Set()
    for (const m of stripCodeBlocks(content).matchAll(WIKILINK_RE)) {
      const t = m[1].split('#')[0].trim()
      if (t && !t.startsWith('_sources/')) targets.add(t)
    }
    if (targets.size === 0) return null

    const index = await indexPageStems(pagesRoot)
    const inGroup = (p) => p === groupDir || p.startsWith(groupDir + sep)

    const leaked = []
    for (const target of targets) {
      const paths = index.get(target) ?? index.get(slugifyTitle(target)) ?? []
      if (paths.length === 0) continue // resolves nowhere — no name disclosed
      if (!paths.some(inGroup)) leaked.push(target)
    }

    if (leaked.length === 0) return null
    return `links to ${leaked.map((t) => `[[${t}]]`).join(', ')} outside the shared group`
  }
}
