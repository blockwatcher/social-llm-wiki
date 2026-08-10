import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * wiki_write_inbox — Write an entry to short-term memory
 *
 * Creates a new entry in wiki/inbox/<channel>/.
 * Intended for auto-ingest: notes, snippets, observations
 * that can later be promoted in the LLM review step.
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

  // YAML safety: any string starting with @ or containing : / # / etc must be quoted.
  // Strings get double-quoted with embedded " escaped as \".
  const yamlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const safeAuthor = yamlString(namespace)
  const safeTitle = yamlString(title || 'Untitled')
  const safeChannel = yamlString(channel)

  const fileContent = `---
channel: ${safeChannel}
schema: text/note
author: ${safeAuthor}
ingested: ${now.toISOString()}
title: ${safeTitle}
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
      text: `Entry saved: inbox/${channel}/${filename}`,
    }],
  }
}
