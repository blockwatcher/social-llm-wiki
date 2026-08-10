/**
 * Path containment for caller-supplied path fragments.
 *
 * `namespace`, `subpath` and `path` arrive straight from an MCP client, so a
 * `..` segment (or an absolute path) must never be able to walk out of the
 * wiki root. This matters beyond the local stdio case: the HTTP transport
 * binds 0.0.0.0:8787, so an unguarded join exposes the whole filesystem to
 * anyone who can reach the port.
 */

import { resolve, sep } from 'node:path'

/**
 * Resolve path segments against the wiki root, refusing anything that escapes.
 *
 * Returns the resolved absolute path, or `null` if it would leave the root.
 * The `startsWith(root + sep)` form is deliberate — a bare prefix check would
 * also accept a sibling directory like `<root>-backup`.
 */
export function resolveInsideWiki(wikiRoot, ...segments) {
  const root = resolve(wikiRoot)
  const full = resolve(root, ...segments.filter(Boolean).map(String))
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

/** Standard MCP error payload for a rejected path. */
export function outsideRootError(label) {
  return {
    content: [{ type: 'text', text: `Error: path is outside the wiki root: ${label}` }],
    isError: true,
  }
}
