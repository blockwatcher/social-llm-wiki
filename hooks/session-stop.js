#!/usr/bin/env node
/**
 * Claude Code Hook: Stop
 *
 * Saves a session entry to wiki/inbox/claude-sessions/ at the end of each session.
 * Acts as automatic short-term memory: what happened during this session?
 *
 * The LLM review step (Kai) later decides whether to promote it to a wiki page.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const WIKI_ROOT = process.env.WIKI_ROOT ?? '/home/darius/social-llm-wiki/wiki'
const INBOX_DIR = join(WIKI_ROOT, 'inbox', 'claude-sessions')

// Read stdin (Claude Code passes stop info as JSON)
let stopInfo = {}
try {
  const raw = await readAll(process.stdin)
  if (raw.trim()) stopInfo = JSON.parse(raw)
} catch {}

const {
  session_id = 'unknown',
  cwd = process.cwd(),
  transcript_path,
} = stopInfo

await mkdir(INBOX_DIR, { recursive: true })

const now = new Date()
const dateStr = now.toISOString().slice(0, 10)
const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-')
const filename = `${dateStr}-${timeStr}-${session_id.slice(0, 8)}.md`
const filePath = join(INBOX_DIR, filename)

// Include transcript summary if available
let transcriptNote = ''
if (transcript_path && existsSync(transcript_path)) {
  try {
    const raw = await readFile(transcript_path, 'utf8')
    const messages = JSON.parse(raw)
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .slice(-5) // letzte 5 User-Nachrichten
    if (userMessages.length > 0) {
      transcriptNote = '\n## Last user messages\n\n' +
        userMessages.map((m) => `- ${m.slice(0, 120).replace(/\n/g, ' ')}`).join('\n')
    }
  } catch {}
}

const content = `---
channel: claude-session
schema: text/session
ingested: ${now.toISOString()}
session_id: ${session_id}
cwd: ${cwd}
ttl: 30d
promoted: false
---

# Claude Code Session — ${dateStr} ${timeStr.replace(/-/g, ':')}

**Working directory:** \`${cwd}\`
**Session ID:** \`${session_id}\`
${transcriptNote}
`

await writeFile(filePath, content, 'utf8')

// No output needed — Stop hook does not return anything to Claude
