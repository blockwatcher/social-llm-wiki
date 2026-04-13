#!/usr/bin/env node
/**
 * Claude Code Hook: SessionStart
 *
 * Lädt relevante Wiki-Seiten als Kontext in die Session.
 * Konfiguration in ~/.claude/settings.json (siehe hooks/settings-example.json).
 *
 * Output: JSON mit additionalContext → Claude sieht den Wiki-Inhalt am Sessionstart.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'

const WIKI_ROOT = process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki'
const NAMESPACE = process.env.WIKI_NAMESPACE ?? '@darius'
const MAX_PAGES = parseInt(process.env.WIKI_MAX_PAGES ?? '10')
const MAX_CHARS_PER_PAGE = 600

// Stdin lesen (Claude Code übergibt Session-Info als JSON)
let sessionInfo = {}
try {
  const raw = await readAll(process.stdin)
  if (raw.trim()) sessionInfo = JSON.parse(raw)
} catch {}

const namespacePath = join(WIKI_ROOT, NAMESPACE)

if (!existsSync(namespacePath)) {
  // Wiki existiert noch nicht — kein Fehler, einfach nichts tun
  process.exit(0)
}

// Alle Markdown-Seiten einlesen, nach letzter Änderung sortieren
const pages = await collectPages(namespacePath)
pages.sort((a, b) => b.mtime - a.mtime)
const recent = pages.slice(0, MAX_PAGES)

if (recent.length === 0) {
  process.exit(0)
}

// Context-Text aufbauen
const lines = [
  `## Wiki Memory (${NAMESPACE})`,
  `_${recent.length} Seiten geladen aus ${relative(process.env.HOME ?? '', WIKI_ROOT)}/${NAMESPACE}/_`,
  '',
]

for (const page of recent) {
  const preview = page.content
    .replace(/^---[\s\S]*?---\n?/, '')   // frontmatter entfernen
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE)
    .replace(/\n{3,}/g, '\n\n')
  lines.push(`### ${page.relPath}`)
  lines.push(preview)
  if (page.content.length > MAX_CHARS_PER_PAGE) lines.push('_[…]_')
  lines.push('')
}

const additionalContext = lines.join('\n')

// Als JSON ausgeben — Claude Code injiziert additionalContext in die Session
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}))

// --- Hilfsfunktionen ---

async function collectPages(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectPages(full, base))
    } else if (entry.name.endsWith('.md')) {
      const s = await stat(full)
      const content = await readFile(full, 'utf8')
      results.push({
        relPath: relative(base, full),
        content,
        mtime: s.mtimeMs,
      })
    }
  }
  return results
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}
