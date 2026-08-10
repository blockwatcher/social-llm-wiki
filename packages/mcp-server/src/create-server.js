/**
 * Social LLM Wiki — MCP server factory.
 *
 * Returns a fully configured McpServer with all wiki tools registered.
 * Shared by the stdio entry (index.js) and the HTTP entry (http.js).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolve } from 'node:path'

import { wikiList } from './tools/wiki-list.js'
import { wikiRead } from './tools/wiki-read.js'
import { wikiSearch } from './tools/wiki-search.js'
import { wikiWriteInbox } from './tools/wiki-write-inbox.js'
import { wikiWritePage } from './tools/wiki-write-page.js'
import { wikiGraph } from './tools/wiki-graph.js'
import { wikiGaps } from './tools/wiki-gaps.js'

export const WIKI_ROOT = resolve(
  process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki',
)

/**
 * Who this server instance writes as. The wiki is co-edited — each peer runs
 * its own MCP server against its own copy, so the identity belongs to the
 * deployment, not to the model's guess at call time.
 */
export const WIKI_AUTHOR = process.env.WIKI_AUTHOR ?? '@darius'

/**
 * Shared groups under pages/social/ this server may write to, first one being the
 * default. Each group is its own P2P sync namespace with its own peer circle, so
 * the allowlist — not just the path guard — is what keeps a page from reaching
 * people it was never meant for. `WIKI_SHARED_GROUPS` takes a comma-separated
 * list; the older single-value `WIKI_SHARED_GROUP` still works.
 */
export const WIKI_SHARED_GROUPS = (
  process.env.WIKI_SHARED_GROUPS ?? process.env.WIKI_SHARED_GROUP ?? 'darius-lukas'
)
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)

export const WIKI_DEFAULT_GROUP = WIKI_SHARED_GROUPS[0] ?? 'darius-lukas'

export function createWikiServer() {
  const server = new McpServer({
    name: 'social-llm-wiki',
    version: '0.1.0',
  })

  // ─── Tool: wiki_list ──────────────────────────────────────────────────────

  server.tool(
    'wiki_list',
    'List wiki pages under a path (file tree + titles). ' +
    'Use this to explore what is available before calling wiki_read or wiki_search. ' +
    'Paths come back relative to the wiki root, so they can be passed to wiki_read as-is.',
    {
      namespace: z.string().optional().describe(
        'Path prefix relative to the wiki root. "pages" = all curated pages, ' +
        '"pages/<category>" = one category, ' +
        `"pages/social/${WIKI_DEFAULT_GROUP}" = the shared branch, ` +
        '"inbox" = unpromoted notes. Empty = whole wiki.',
      ),
      subpath: z.string().optional().describe(
        'Optional further subfolder below `namespace`, e.g. "go-rechenkern".',
      ),
    },
    async ({ namespace, subpath }) =>
      wikiList({ wikiRoot: WIKI_ROOT, namespace, subpath }),
  )

  // ─── Tool: wiki_read ──────────────────────────────────────────────────────

  server.tool(
    'wiki_read',
    'Read a single wiki page and return its full Markdown content.',
    {
      path: z.string().describe(
        'Path to the page relative to the wiki root, exactly as wiki_list and ' +
        `wiki_search report it, e.g. "pages/social/${WIKI_DEFAULT_GROUP}/go-rechenkern/` +
        'go-rechenkern-uebersicht.md".',
      ),
    },
    async ({ path }) =>
      wikiRead({ wikiRoot: WIKI_ROOT, path }),
  )

  // ─── Tool: wiki_search ────────────────────────────────────────────────────

  server.tool(
    'wiki_search',
    'Search all wiki pages for a keyword or phrase. ' +
    'Returns matching pages with context excerpts, sorted by hit count. ' +
    'Paths come back relative to the wiki root, so they can be passed to wiki_read as-is.',
    {
      query: z.string().describe(
        'Search term or phrase, e.g. "libp2p" or "Zugspitze".',
      ),
      namespace: z.string().optional().describe(
        'Restrict the search to this path prefix, e.g. "pages" or ' +
        `"pages/social/${WIKI_DEFAULT_GROUP}". Empty = whole wiki.`,
      ),
    },
    async ({ query, namespace }) =>
      wikiSearch({ wikiRoot: WIKI_ROOT, query, namespace }),
  )

  // ─── Tool: wiki_write_inbox ───────────────────────────────────────────────

  server.tool(
    'wiki_write_inbox',
    'Save a new entry to short-term memory (inbox/). ' +
    'Use this whenever you want to record a note, observation, or piece of information ' +
    'that can later be promoted to long-term memory (wiki/) by the LLM review step. ' +
    'Do NOT write directly to wiki/ — always go through inbox/.',
    {
      content: z.string().describe(
        'Content of the note (Markdown).',
      ),
      title: z.string().optional().describe(
        'Optional title for the note.',
      ),
      channel: z.string().optional().describe(
        'Channel/category, e.g. "notes", "tasks", "research". Default: "notes".',
      ),
      tags: z.array(z.string()).optional().describe(
        'Tags as an array, e.g. ["project", "libp2p"].',
      ),
      namespace: z.string().optional().describe(
        `Author namespace, e.g. "@darius". Omit unless the note is written on someone ` +
        `else's behalf — this server writes as ${WIKI_AUTHOR}.`,
      ),
    },
    async ({ content, title, channel, tags, namespace }) =>
      wikiWriteInbox({
        wikiRoot: WIKI_ROOT, content, title, channel, tags,
        namespace: namespace ?? WIKI_AUTHOR,
      }),
  )

  // ─── Tool: wiki_write_page ────────────────────────────────────────────────

  server.tool(
    'wiki_write_page',
    `Create or update a curated page in a shared wiki group (pages/social/<group>/, ` +
    `default "${WIKI_DEFAULT_GROUP}"), co-edited with that group's peers over P2P sync. ` +
    'Any topic is allowed — organize freely with the optional `folder`. Unlike ' +
    'wiki_write_inbox (short-term, promoted later), this writes a finished page directly. ' +
    'Read the current page with wiki_read first, then write back the full updated Markdown ' +
    'body. Writes are hard-restricted to the shared group folder. Because the page syncs ' +
    'to everyone in the group, [[wikilinks]] may only point at pages inside the same ' +
    'group — refer to private pages by name in plain text instead.',
    {
      slug: z.string().describe(
        'Page slug (lowercase letters, digits, hyphens), e.g. "immissionsschutz-veranstaltungen". ' +
        'Must be unique across the whole wiki — the index addresses pages by filename, not ' +
        'by path, so a generic slug like "uebersicht" will be rejected as a collision.',
      ),
      title: z.string().describe('Human-readable page title.'),
      content: z.string().describe(
        'Full Markdown body of the page (without frontmatter and without the top-level # title — those are generated).',
      ),
      folder: z.string().optional().describe(
        'Optional subfolder within the group to organize by topic, e.g. "laermzentrale" or "go-rechenkern" or "notizen". Nested paths like "a/b" allowed. Omit for a top-level page.',
      ),
      tags: z.array(z.string()).optional().describe('Tags, e.g. ["tifl", "messsystem"].'),
      author: z.string().optional().describe(
        `Who is editing. Omit unless editing on someone else's behalf — this server ` +
        `writes as ${WIKI_AUTHOR}. Recorded as last editor and added to the contributors list.`,
      ),
      summary: z.string().optional().describe(
        'Optional one-sentence summary rendered under the title.',
      ),
      group: z.string().optional().describe(
        WIKI_SHARED_GROUPS.length > 1
          ? `Shared group to write to — one of: ${WIKI_SHARED_GROUPS.join(', ')}. ` +
            `Each has its own peer circle. Default: "${WIKI_DEFAULT_GROUP}".`
          : `Shared group to write to. This server shares only "${WIKI_DEFAULT_GROUP}" — omit it.`,
      ),
    },
    async ({ slug, title, content, folder, tags, author, summary, group }) =>
      wikiWritePage({
        wikiRoot: WIKI_ROOT, slug, title, content, folder, tags, summary,
        author: author ?? WIKI_AUTHOR,
        group: group ?? WIKI_DEFAULT_GROUP,
        allowedGroups: WIKI_SHARED_GROUPS,
      }),
  )

  // ─── Tool: wiki_graph ─────────────────────────────────────────────────────

  server.tool(
    'wiki_graph',
    'Analyze the knowledge graph of a wiki namespace. ' +
    'Returns page count, link count, clusters, orphans, and bridge pages. ' +
    'Use wiki_gaps for gap analysis and research question prompts.',
    {
      namespace: z.string().optional().describe(
        'Path prefix to analyze, e.g. "pages" for the curated wiki or ' +
        `"pages/social/${WIKI_DEFAULT_GROUP}" for the shared branch. Empty = whole wiki.`,
      ),
    },
    async ({ namespace }) =>
      wikiGraph({ wikiRoot: WIKI_ROOT, namespace }),
  )

  // ─── Tool: wiki_gaps ──────────────────────────────────────────────────────

  server.tool(
    'wiki_gaps',
    'Find knowledge gaps in the wiki — clusters of pages that are not connected to each other. ' +
    'Each gap comes with a targeted research prompt to generate non-obvious insights. ' +
    'Also reports orphan pages, missing pages, and structural lint issues. ' +
    'This is the core InfraNodus approach: use graph structure to escape generic LLM answers.',
    {
      namespace: z.string().optional().describe(
        'Path prefix to analyze, e.g. "pages" for the curated wiki or ' +
        `"pages/social/${WIKI_DEFAULT_GROUP}" for the shared branch. Empty = whole wiki.`,
      ),
    },
    async ({ namespace }) =>
      wikiGaps({ wikiRoot: WIKI_ROOT, namespace }),
  )

  return server
}
