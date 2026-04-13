import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * wiki_read — Read a single wiki page
 *
 * Reads the page at the given path (relative to wiki/).
 * Returns the full Markdown content.
 */
export async function wikiRead({ wikiRoot, path: pagePath }) {
  const fullPath = resolve(join(wikiRoot, pagePath))

  // Path traversal guard
  if (!fullPath.startsWith(resolve(wikiRoot))) {
    return { content: [{ type: 'text', text: 'Error: path is outside wiki root.' }], isError: true }
  }

  if (!existsSync(fullPath)) {
    return { content: [{ type: 'text', text: `Page not found: ${pagePath}` }], isError: true }
  }

  const content = await readFile(fullPath, 'utf8')
  return { content: [{ type: 'text', text: content }] }
}
