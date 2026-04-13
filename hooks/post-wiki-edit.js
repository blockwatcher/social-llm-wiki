#!/usr/bin/env node
/**
 * Claude Code Hook: PostToolUse (Write / Edit)
 *
 * Wenn Claude eine Datei in wiki/ schreibt oder editiert,
 * wird ein Maintenance-Trigger in inbox/triggers/ abgelegt.
 * Kai kann diese Trigger periodisch lesen und betroffene Seiten
 * im LLM-Review-Schritt neu kuratieren.
 *
 * Matcher in settings.json: "Write|Edit"
 * Nur aktiv wenn die Datei innerhalb von WIKI_ROOT liegt.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const WIKI_ROOT = resolve(process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki')
const TRIGGERS_DIR = join(WIKI_ROOT, 'inbox', 'triggers')

// Stdin: PostToolUse-Payload von Claude Code
let payload = {}
try {
  const raw = await readAll(process.stdin)
  if (raw.trim()) payload = JSON.parse(raw)
} catch {}

const filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? ''

// Nur reagieren wenn Datei innerhalb des Wiki-Roots liegt
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

// --- Hilfsfunktionen ---

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}
