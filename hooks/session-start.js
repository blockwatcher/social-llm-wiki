#!/usr/bin/env node
/**
 * Claude Code Hook: SessionStart
 *
 * Loads recent wiki pages as context into the session.
 * Configuration in ~/.claude/settings.json (see hooks/settings-example.json).
 *
 * Output: JSON with additionalContext → Claude sees wiki content at session start.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'

const WIKI_ROOT = process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki'
const NAMESPACE = process.env.WIKI_NAMESPACE ?? '@darius'
const MAX_PAGES = parseInt(process.env.WIKI_MAX_PAGES ?? '10')
const MAX_CHARS_PER_PAGE = 600

// Read stdin (Claude Code passes session info as JSON)
let sessionInfo = {}
try {
  const raw = await readAll(process.stdin)
  if (raw.trim()) sessionInfo = JSON.parse(raw)
} catch {}

const namespacePath = join(WIKI_ROOT, NAMESPACE)

if (!existsSync(namespacePath)) {
  // Wiki does not exist yet — no error, just skip
  process.exit(0)
}

// Collect all Markdown pages, sort by last modified
const pages = await collectPages(namespacePath)
pages.sort((a, b) => b.mtime - a.mtime)
const recent = pages.slice(0, MAX_PAGES)

if (recent.length === 0) {
  process.exit(0)
}

// Context-Text aufbauen
const lines = [
  `## Wiki Memory (${NAMESPACE})`,
  `_${recent.length} page(s) loaded from ${relative(process.env.HOME ?? '', WIKI_ROOT)}/${NAMESPACE}/_`,
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

// Output JSON — Claude Code injects additionalContext into the session
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}))

// --- Helpers ---

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
