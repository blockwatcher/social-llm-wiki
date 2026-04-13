#!/usr/bin/env node
/**
 * Social LLM Wiki — Edit Server
 *
 * A lightweight HTTP server that provides an in-browser Markdown editor
 * for Quartz wiki pages. Runs alongside the Quartz dev server.
 *
 * Routes:
 *   GET  /edit?file=<relative-path>   Serve the editor UI for a wiki page
 *   POST /save                         Save the edited content back to disk
 *   GET  /health                       Health check
 *
 * Start: node packages/edit-server/src/index.js
 * Or:    npm start --workspace=@social-llm-wiki/edit-server
 */

import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { marked } from 'marked'

const PORT      = parseInt(process.env.EDIT_PORT  ?? '7800')
const WIKI_ROOT = resolve(process.env.WIKI_ROOT   ?? '/home/darius/social-llm-wiki/wiki')
const QUARTZ_URL = process.env.QUARTZ_URL         ?? 'http://localhost:8080'

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    // ── GET /health ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, { ok: true, wikiRoot: WIKI_ROOT })
      return
    }

    // ── GET /edit?file=<path> ────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/edit') {
      const filePath = url.searchParams.get('file')
      if (!filePath) { badRequest(res, 'Missing ?file= parameter'); return }

      const fullPath = safePath(filePath)
      if (!fullPath) { forbidden(res); return }
      if (!existsSync(fullPath)) { notFound(res, filePath); return }

      const content = await readFile(fullPath, 'utf8')
      const preview = await marked.parse(content)

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(editorHTML({ filePath, content, preview, quartzUrl: QUARTZ_URL }))
      return
    }

    // ── POST /save ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/save') {
      const body = await readBody(req)
      const { file, content } = JSON.parse(body)

      if (!file || content === undefined) { badRequest(res, 'Missing file or content'); return }

      const fullPath = safePath(file)
      if (!fullPath) { forbidden(res); return }

      await writeFile(fullPath, content, 'utf8')
      json(res, { ok: true, file })
      return
    }

    // ── GET /preview (live preview during editing) ───────────────────────────
    if (req.method === 'POST' && url.pathname === '/preview') {
      const body = await readBody(req)
      const { content } = JSON.parse(body)
      const html = await marked.parse(content ?? '')
      json(res, { html })
      return
    }

    notFound(res, url.pathname)

  } catch (err) {
    console.error('[edit-server] Error:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[edit-server] Running at http://127.0.0.1:${PORT}`)
  console.log(`[edit-server] Wiki root: ${WIKI_ROOT}`)
  console.log(`[edit-server] Quartz:    ${QUARTZ_URL}`)
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a relative file path and guard against path traversal. */
function safePath(filePath) {
  const full = resolve(join(WIKI_ROOT, filePath))
  if (!full.startsWith(WIKI_ROOT)) return null
  if (extname(full) !== '.md') return null
  return full
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function badRequest(res, msg) { json(res, { error: msg }, 400) }
function forbidden(res)       { json(res, { error: 'Path outside wiki root or not a .md file' }, 403) }
function notFound(res, path)  { json(res, { error: `Not found: ${path}` }, 404) }

// ── Editor HTML ───────────────────────────────────────────────────────────────

function editorHTML({ filePath, content, preview, quartzUrl }) {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit — ${filePath}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #1e1e2e;
      --surface:  #2a2a3e;
      --border:   #3d3d5c;
      --text:     #cdd6f4;
      --muted:    #6c7086;
      --accent:   #89b4fa;
      --success:  #a6e3a1;
      --danger:   #f38ba8;
      --font-ui:  system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .toolbar .path {
      flex: 1;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar .path span { color: var(--accent); }

    .status {
      font-size: 12px;
      color: var(--muted);
      transition: color 0.3s;
    }
    .status.saved  { color: var(--success); }
    .status.saving { color: var(--accent); }
    .status.error  { color: var(--danger); }

    button {
      padding: 6px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    button:hover { background: var(--border); border-color: var(--accent); }

    button.primary {
      background: var(--accent);
      color: var(--bg);
      border-color: var(--accent);
      font-weight: 600;
    }
    button.primary:hover { filter: brightness(1.1); }

    /* ── Split pane ── */
    .panes {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }
    .pane:last-child { border-right: none; }

    .pane-label {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    #editor {
      flex: 1;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.7;
      padding: 16px;
      border: none;
      outline: none;
      resize: none;
      tab-size: 2;
      overflow-y: auto;
    }

    #preview {
      flex: 1;
      padding: 20px 24px;
      overflow-y: auto;
      font-size: 15px;
      line-height: 1.75;
    }

    /* ── Preview Markdown styles ── */
    #preview h1, #preview h2, #preview h3,
    #preview h4, #preview h5, #preview h6 {
      color: var(--accent);
      margin: 1.2em 0 0.4em;
      line-height: 1.3;
    }
    #preview h1 { font-size: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    #preview h2 { font-size: 1.3em; }
    #preview h3 { font-size: 1.1em; }
    #preview p  { margin: 0.75em 0; }
    #preview a  { color: var(--accent); }
    #preview code {
      font-family: var(--font-mono);
      font-size: 0.88em;
      background: var(--surface);
      padding: 2px 5px;
      border-radius: 4px;
    }
    #preview pre {
      background: var(--surface);
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
    }
    #preview pre code { background: none; padding: 0; }
    #preview blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      color: var(--muted);
      margin: 1em 0;
    }
    #preview ul, #preview ol { padding-left: 1.5em; margin: 0.5em 0; }
    #preview li { margin: 0.3em 0; }
    #preview table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    #preview th, #preview td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
    }
    #preview th { background: var(--surface); color: var(--accent); }
    #preview hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }

    /* ── Unsaved indicator ── */
    body.dirty .toolbar .path::after {
      content: ' •';
      color: var(--danger);
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="path">wiki / <span>${escapeHtml(filePath)}</span></div>
    <span class="status" id="status">Ready</span>
    <button onclick="openQuartz()">← Back</button>
    <button class="primary" onclick="save()" id="saveBtn">Save</button>
  </div>
  <div class="panes">
    <div class="pane">
      <div class="pane-label">Markdown</div>
      <textarea id="editor" spellcheck="false">${escapeHtml(content)}</textarea>
    </div>
    <div class="pane">
      <div class="pane-label">Preview</div>
      <div id="preview">${preview}</div>
    </div>
  </div>

  <script>
    const FILE = ${JSON.stringify(filePath)}
    const QUARTZ_URL = ${JSON.stringify(quartzUrl)}
    const editor = document.getElementById('editor')
    const preview = document.getElementById('preview')
    const status = document.getElementById('status')

    let previewTimer = null
    let dirty = false

    function markDirty() {
      if (!dirty) { dirty = true; document.body.classList.add('dirty') }
    }

    editor.addEventListener('input', () => {
      markDirty()
      clearTimeout(previewTimer)
      previewTimer = setTimeout(updatePreview, 400)
    })

    async function updatePreview() {
      try {
        const res = await fetch('/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editor.value }),
        })
        const { html } = await res.json()
        preview.innerHTML = html
      } catch {}
    }

    async function save() {
      setStatus('saving', 'Saving…')
      try {
        const res = await fetch('/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: FILE, content: editor.value }),
        })
        if (!res.ok) throw new Error(await res.text())
        dirty = false
        document.body.classList.remove('dirty')
        setStatus('saved', 'Saved ✓')
        setTimeout(() => setStatus('', 'Ready'), 2500)
      } catch (err) {
        setStatus('error', 'Save failed: ' + err.message)
      }
    }

    function openQuartz() {
      const slug = FILE.replace(/\\.md$/, '').replace(/^@[^/]+\\//, '')
      window.location.href = QUARTZ_URL + '/' + slug
    }

    function setStatus(cls, text) {
      status.className = 'status ' + cls
      status.textContent = text
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    })

    // Warn on unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = '' }
    })
  </script>
</body>
</html>`
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
