#!/usr/bin/env node
/**
 * Claude Code Hook: PostToolUse (Write / Edit)
 *
 * When Claude writes or edits a file inside wiki/, a maintenance
 * trigger is dropped into inbox/triggers/. Kai reads these triggers
 * periodically and re-curates the affected pages in the LLM review step.
 *
 * Matcher in settings.json: "Write|Edit"
 * Only active when the file is inside WIKI_ROOT.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const WIKI_ROOT = resolve(process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki')
const TRIGGERS_DIR = join(WIKI_ROOT, 'inbox', 'triggers')

// Stdin: PostToolUse payload from Claude Code
let payload = {}
try {
  const raw = await readAll(process.stdin)
  if (raw.trim()) payload = JSON.parse(raw)
} catch {}

const filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? ''

// Only act when the file is inside the wiki root
if (!filePath || !resolve(filePath).startsWith(WIKI_ROOT)) {
  process.exit(0)
}

await mkdir(TRIGGERS_DIR, { recursive: true })

const now = new Date()
const ts = now.toISOString().replace(/[:.]/g, '-')
const triggerFile = join(TRIGGERS_DIR, `${ts}-maintain.json`)

await writeFile(triggerFile, JSON.stringify({
  type: 'maintain',
  file: filePath,
  tool: payload?.tool_name ?? 'unknown',
  triggered: now.toISOString(),
}, null, 2), 'utf8')

// --- Helpers ---

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}
