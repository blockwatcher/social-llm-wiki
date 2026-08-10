import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { resolveInsideWiki, outsideRootError } from '../safe-path.js'

/**
 * wiki_read — Read a single wiki page
 *
 * Reads the page at the given path (relative to wiki/).
 * Returns the full Markdown content.
 */
export async function wikiRead({ wikiRoot, path: pagePath }) {
  const fullPath = resolveInsideWiki(wikiRoot, pagePath)

  if (!fullPath) {
    return outsideRootError(pagePath)
  }

  if (!existsSync(fullPath)) {
    return { content: [{ type: 'text', text: `Page not found: ${pagePath}` }], isError: true }
  }

  const content = await readFile(fullPath, 'utf8')
  return { content: [{ type: 'text', text: content }] }
}
