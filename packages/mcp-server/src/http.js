#!/usr/bin/env node
/**
 * Social LLM Wiki — MCP Server (HTTP / StreamableHTTP transport)
 *
 * Network-accessible variant of index.js. Lets MCP clients on other machines
 * connect over HTTP instead of spawning a local subprocess.
 *
 * Start:   node packages/mcp-server/src/http.js
 * Connect: claude mcp add --transport http wiki http://<host>:8787/mcp
 *
 * Environment:
 *   WIKI_ROOT        Path to the wiki root (see create-server.js for default)
 *   WIKI_HTTP_PORT   Listen port            (default: 8787)
 *   WIKI_HTTP_HOST   Bind address           (default: 0.0.0.0 — all interfaces)
 *   WIKI_HTTP_TOKEN  Optional bearer token. If set, requests must send
 *                    `Authorization: Bearer <token>`.
 *
 * Stateless mode: a fresh server + transport is created per request, so no
 * session state is kept between calls. Fine for the wiki's request/response
 * tools (no server-initiated notifications needed).
 */

import { createServer } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { createWikiServer, WIKI_ROOT } from './create-server.js'

const PORT = Number(process.env.WIKI_HTTP_PORT ?? 8787)
const HOST = process.env.WIKI_HTTP_HOST ?? '0.0.0.0'
const TOKEN = process.env.WIKI_HTTP_TOKEN ?? ''

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

  // Optional bearer-token auth, ahead of every route including /health.
  //
  // /health answered before this check and reported wikiRoot, so an
  // unauthenticated caller on the LAN learned where the wiki lives. A health
  // endpoint is not worth a disclosure: nothing here polls it automatically —
  // the systemd unit has no health check — and an operator holds the token.
  if (TOKEN) {
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${TOKEN}`) {
      return sendJson(res, 401, { error: 'unauthorized' })
    }
  }

  // Health check — handy for systemd / monitoring.
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', wikiRoot: WIKI_ROOT })
  }

  if (url.pathname !== '/mcp') {
    return sendJson(res, 404, { error: 'not found' })
  }

  if (req.method !== 'POST') {
    // Stateless mode has no standalone SSE stream or session to delete.
    res.writeHead(405, { Allow: 'POST' })
    return res.end()
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    return sendJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    })
  }

  // Fresh server + transport per request (stateless).
  const server = createWikiServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  res.on('close', () => {
    transport.close()
    server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err) {
    console.error('[wiki-mcp] request failed:', err)
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
})

httpServer.listen(PORT, HOST, () => {
  console.error(
    `[wiki-mcp] HTTP transport listening on http://${HOST}:${PORT}/mcp ` +
    `(wikiRoot=${WIKI_ROOT}${TOKEN ? ', auth=bearer' : ''})`,
  )
})
