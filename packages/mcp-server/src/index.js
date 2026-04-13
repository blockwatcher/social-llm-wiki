#!/usr/bin/env node
/**
 * Social LLM Wiki — MCP Server
 *
 * Stellt das Wiki als Tools für jeden MCP-kompatiblen Client bereit:
 *   - Claude Code CLI  (settings.json → mcpServers)
 *   - Claude Desktop / Cowork  (claude_desktop_config.json → mcpServers)
 *   - Andere MCP-Clients (Cursor, Continue, ...)
 *
 * Starten: node packages/mcp-server/src/index.js
 * Debuggen: npm run inspect --workspace=@social-llm-wiki/mcp-server
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
  'Listet alle Wiki-Seiten eines Namespace auf (Dateibaum + Titel). ' +
  'Nutze dies um zu sehen was im Wiki vorhanden ist, bevor du wiki_read oder wiki_search aufrufst.',
  {
    namespace: z.string().optional().describe(
      'Namespace z.B. "@darius", "@soenke", "groups/hiking". Leer = alle.',
    ),
    subpath: z.string().optional().describe(
      'Optionaler Unterordner, z.B. "reisen" oder "notizen".',
    ),
  },
  async ({ namespace, subpath }) =>
    wikiList({ wikiRoot: WIKI_ROOT, namespace, subpath }),
)

// ─── Tool: wiki_read ────────────────────────────────────────────────────────

server.tool(
  'wiki_read',
  'Liest eine einzelne Wiki-Seite und gibt den vollständigen Markdown-Inhalt zurück. ' +
  'Pfad ist relativ zum Wiki-Root, z.B. "@darius/notizen/social-llm-wiki.md".',
  {
    path: z.string().describe(
      'Relativer Pfad zur Wiki-Seite, z.B. "@darius/reisen/zugspitze.md".',
    ),
  },
  async ({ path }) =>
    wikiRead({ wikiRoot: WIKI_ROOT, path }),
)

// ─── Tool: wiki_search ──────────────────────────────────────────────────────

server.tool(
  'wiki_search',
  'Durchsucht alle Wiki-Seiten nach einem Stichwort oder einer Phrase. ' +
  'Gibt Treffer mit Kontext-Ausschnitten zurück. ' +
  'Optional auf einen Namespace einschränken.',
  {
    query: z.string().describe(
      'Suchbegriff oder Phrase, z.B. "libp2p" oder "Zugspitze".',
    ),
    namespace: z.string().optional().describe(
      'Suche auf diesen Namespace einschränken, z.B. "@darius". Leer = Wiki-weit.',
    ),
  },
  async ({ query, namespace }) =>
    wikiSearch({ wikiRoot: WIKI_ROOT, query, namespace }),
)

// ─── Tool: wiki_write_inbox ─────────────────────────────────────────────────

server.tool(
  'wiki_write_inbox',
  'Speichert einen neuen Eintrag im Kurzzeitgedächtnis (inbox/). ' +
  'Nutze dies wenn du eine Notiz, Beobachtung oder Information festhalten willst, ' +
  'die später vom LLM-Review-Schritt ins Langzeitgedächtnis (wiki/) promoten werden kann. ' +
  'Schreibe NICHT direkt in wiki/ — immer über inbox/ gehen.',
  {
    content: z.string().describe(
      'Inhalt der Notiz (Markdown).',
    ),
    title: z.string().optional().describe(
      'Optionaler Titel der Notiz.',
    ),
    channel: z.string().optional().describe(
      'Channel/Kategorie, z.B. "notes", "tasks", "research". Default: "notes".',
    ),
    tags: z.array(z.string()).optional().describe(
      'Tags als Array, z.B. ["projekt", "libp2p"].',
    ),
    namespace: z.string().optional().describe(
      'Namespace des Autors, z.B. "@darius". Default: "@darius".',
    ),
  },
  async ({ content, title, channel, tags, namespace }) =>
    wikiWriteInbox({ wikiRoot: WIKI_ROOT, content, title, channel, tags, namespace }),
)

// ─── Server starten ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
