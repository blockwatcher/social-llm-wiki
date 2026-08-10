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

export function createWikiServer() {
  const server = new McpServer({
    name: 'social-llm-wiki',
    version: '0.1.0',
  })

  // ─── Tool: wiki_list ──────────────────────────────────────────────────────

  server.tool(
    'wiki_list',
    'List all wiki pages in a namespace (file tree + titles). ' +
    'Use this to explore what is available before calling wiki_read or wiki_search.',
    {
      namespace: z.string().optional().describe(
        'Namespace to list, e.g. "@darius", "@soenke", "groups/hiking". Empty = all.',
      ),
      subpath: z.string().optional().describe(
        'Optional subfolder within the namespace, e.g. "reisen" or "notizen".',
      ),
    },
    async ({ namespace, subpath }) =>
      wikiList({ wikiRoot: WIKI_ROOT, namespace, subpath }),
  )

  // ─── Tool: wiki_read ──────────────────────────────────────────────────────

  server.tool(
    'wiki_read',
    'Read a single wiki page and return its full Markdown content. ' +
    'Path is relative to the wiki root, e.g. "@darius/notizen/social-llm-wiki.md".',
    {
      path: z.string().describe(
        'Relative path to the wiki page, e.g. "@darius/reisen/zugspitze.md".',
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
    'Optionally restrict the search to a specific namespace.',
    {
      query: z.string().describe(
        'Search term or phrase, e.g. "libp2p" or "Zugspitze".',
      ),
      namespace: z.string().optional().describe(
        'Restrict search to this namespace, e.g. "@darius". Empty = wiki-wide.',
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
        'Author namespace, e.g. "@darius". Default: "@darius".',
      ),
    },
    async ({ content, title, channel, tags, namespace }) =>
      wikiWriteInbox({ wikiRoot: WIKI_ROOT, content, title, channel, tags, namespace }),
  )

  // ─── Tool: wiki_write_page ────────────────────────────────────────────────

  server.tool(
    'wiki_write_page',
    'Create or update a curated page in the shared "social" wiki branch, ' +
    'co-edited by Darius and Lukas. Unlike wiki_write_inbox (short-term, ' +
    'promoted later), this writes a finished page DIRECTLY into ' +
    'pages/social/<topic>/. Read the current page with wiki_read first, then ' +
    'write back the full updated Markdown body. Writes are restricted to the ' +
    'social branch only.',
    {
      topic: z.enum(['laermzentrale', 'go-rechenkern']).describe(
        'Which shared sub-branch the page belongs to.',
      ),
      slug: z.string().describe(
        'Page slug (lowercase letters, digits, hyphens), e.g. "immissionsschutz-veranstaltungen".',
      ),
      title: z.string().describe('Human-readable page title.'),
      content: z.string().describe(
        'Full Markdown body of the page (without frontmatter and without the top-level # title — those are generated).',
      ),
      tags: z.array(z.string()).optional().describe('Tags, e.g. ["tifl", "messsystem"].'),
      author: z.string().describe(
        'Who is editing, e.g. "@darius" or "@lukas". Recorded as last editor and added to the contributors list.',
      ),
      summary: z.string().optional().describe(
        'Optional one-sentence summary rendered under the title.',
      ),
    },
    async ({ topic, slug, title, content, tags, author, summary }) =>
      wikiWritePage({ wikiRoot: WIKI_ROOT, topic, slug, title, content, tags, author, summary }),
  )

  // ─── Tool: wiki_graph ─────────────────────────────────────────────────────

  server.tool(
    'wiki_graph',
    'Analyze the knowledge graph of a wiki namespace. ' +
    'Returns page count, link count, clusters, orphans, and bridge pages. ' +
    'Use wiki_gaps for gap analysis and research question prompts.',
    {
      namespace: z.string().optional().describe(
        'Namespace to analyze, e.g. "@darius". Empty = all namespaces.',
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
        'Namespace to analyze, e.g. "@darius". Empty = all namespaces.',
      ),
    },
    async ({ namespace }) =>
      wikiGaps({ wikiRoot: WIKI_ROOT, namespace }),
  )

  return server
}
