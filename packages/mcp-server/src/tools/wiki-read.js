import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * wiki_read — Eine Wiki-Seite lesen
 *
 * Liest die Seite am angegebenen Pfad (relativ zu wiki/).
 * Gibt den vollständigen Markdown-Inhalt zurück.
 */
export async function wikiRead({ wikiRoot, path: pagePath }) {
  const fullPath = resolve(join(wikiRoot, pagePath))

  // Path-Traversal-Schutz
  if (!fullPath.startsWith(resolve(wikiRoot))) {
    return { content: [{ type: 'text', text: 'Fehler: Pfad außerhalb des Wiki-Root.' }], isError: true }
  }

  if (!existsSync(fullPath)) {
    return { content: [{ type: 'text', text: `Seite nicht gefunden: ${pagePath}` }], isError: true }
  }

  const content = await readFile(fullPath, 'utf8')
  return { content: [{ type: 'text', text: content }] }
}
