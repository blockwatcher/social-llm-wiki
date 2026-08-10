#!/usr/bin/env node
/**
 * Social LLM Wiki — MCP Server (stdio transport)
 *
 * Exposes the wiki as tools for any MCP-compatible client started as a
 * local subprocess:
 *   - Claude Code CLI  (settings.json → mcpServers)
 *   - Claude Desktop / Cowork  (claude_desktop_config.json → mcpServers)
 *   - Other MCP clients (Cursor, Continue, ...)
 *
 * Start:  node packages/mcp-server/src/index.js
 * Debug:  npm run inspect --workspace=@social-llm-wiki/mcp-server
 *
 * For a network-accessible server, see http.js (HTTP transport).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createWikiServer } from './create-server.js'

const server = createWikiServer()
const transport = new StdioServerTransport()
await server.connect(transport)
