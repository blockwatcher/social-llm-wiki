import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * wiki_write_inbox — Eintrag ins Kurzzeitgedächtnis schreiben
 *
 * Legt einen neuen Eintrag in wiki/inbox/<channel>/ an.
 * Gedacht für auto-ingest: Notizen, Snippets, Beobachtungen
 * die später im LLM-Review-Schritt promotet werden können.
 */
export async function wikiWriteInbox({
  wikiRoot,
  content,
  channel = 'notes',
  title = '',
  tags = [],
  namespace = '@darius',
}) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-')

  const slug = (title || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  const filename = `${dateStr}-${timeStr}-${slug}.md`
  const inboxDir = join(wikiRoot, 'inbox', channel)
  await mkdir(inboxDir, { recursive: true })

  const tagsStr = tags.length > 0 ? `[${tags.map((t) => `"${t}"`).join(', ')}]` : '[]'

  const fileContent = `---
channel: ${channel}
schema: text/note
author: ${namespace}
ingested: ${now.toISOString()}
title: ${title || 'Untitled'}
tags: ${tagsStr}
ttl: 30d
promoted: false
---

${title ? `# ${title}\n\n` : ''}${content}
`

  const filePath = join(inboxDir, filename)
  await writeFile(filePath, fileContent, 'utf8')

  return {
    content: [{
      type: 'text',
      text: `Eintrag gespeichert: inbox/${channel}/${filename}`,
    }],
  }
}
