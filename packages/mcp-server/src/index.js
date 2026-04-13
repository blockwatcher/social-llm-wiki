#!/usr/bin/env node
/**
 * Social LLM Wiki — MCP Server
 *
 * Exposes the wiki as tools for any MCP-compatible client:
 *   - Claude Code CLI  (settings.json → mcpServers)
 *   - Claude Desktop / Cowork  (claude_desktop_config.json → mcpServers)
 *   - Other MCP clients (Cursor, Continue, ...)
 *
 * Start:  node packages/mcp-server/src/index.js
 * Debug:  npm run inspect --workspace=@social-llm-wiki/mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolve } from 'node:path'

import { wikiList } from './tools/wiki-list.js'
import { wikiRead } from './tools/wiki-read.js'
import { wikiSearch } from './tools/wiki-search.js'
import { wikiWriteInbox } from './tools/wiki-write-inbox.js'

const WIKI_ROOT = resolve(process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki')

const server = new McpServer({
  name: 'social-llm-wiki',
  version: '0.1.0',
})

// ─── Tool: wiki_list ────────────────────────────────────────────────────────

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

// ─── Tool: wiki_read ────────────────────────────────────────────────────────

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

// ─── Tool: wiki_search ──────────────────────────────────────────────────────

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

// ─── Tool: wiki_write_inbox ─────────────────────────────────────────────────

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

// ─── Start server ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
