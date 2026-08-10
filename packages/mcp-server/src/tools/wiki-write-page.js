import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/**
 * wiki_write_page — Create or update a page in the shared "social" branch.
 *
 * Unlike wiki_write_inbox (short-term, promote-later), this writes a curated
 * page DIRECTLY into pages/social/<topic>/, so Darius and Lukas can co-edit a
 * shared branch from their own Claude Code sessions over MCP.
 *
 * Safety: writes are hard-scoped to pages/social/. The resolved path must stay
 * inside that directory — any slug containing a slash or `..` is rejected — so
 * this tool can never touch the rest of Kai's wiki tree.
 *
 * Collaboration: `author` is the current editor; a `contributors` set in the
 * frontmatter accumulates everyone who has touched the page. `created` is
 * preserved across edits, `updated` is stamped each write.
 */

const TOPICS = new Set(['laermzentrale', 'go-rechenkern'])
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const yamlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function extractField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim() : null
}

function extractList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'))
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

export async function wikiWritePage({
  wikiRoot,
  topic,
  slug,
  title,
  content,
  tags = [],
  author = '@darius',
  summary = '',
}) {
  if (!TOPICS.has(topic)) {
    throw new Error(`invalid topic "${topic}" — allowed: ${[...TOPICS].join(', ')}`)
  }
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`invalid slug "${slug}" — use lowercase letters, digits and hyphens only`)
  }
  if (!title || !content) {
    throw new Error('title and content are required')
  }

  const socialRoot = resolve(wikiRoot, 'pages', 'social')
  const filePath = resolve(socialRoot, topic, `${slug}.md`)
  // Hard scope guard: the resolved path must live under pages/social/.
  if (filePath !== socialRoot && !filePath.startsWith(socialRoot + sep)) {
    throw new Error('refusing to write outside pages/social/')
  }

  const today = new Date().toISOString().slice(0, 10)

  // Preserve created + tags + accumulate contributors across edits, so an
  // edit that omits metadata never silently drops it from a shared page.
  let created = today
  let contributors = []
  let effectiveTags = tags
  try {
    const existing = await readFile(filePath, 'utf8')
    const fm = existing.slice(0, existing.indexOf('\n---', 4) + 4)
    created = extractField(fm, 'created') || created
    contributors = extractList(fm, 'contributors')
    if (!tags || tags.length === 0) effectiveTags = extractList(fm, 'tags')
  } catch {
    // new page
  }
  if (!contributors.includes(author)) contributors.push(author)

  const tagsStr = effectiveTags.length
    ? `[${effectiveTags.map((t) => `"${t}"`).join(', ')}]`
    : '[]'
  const contribStr = `[${contributors.map((c) => `"${c}"`).join(', ')}]`

  const frontmatter = `---
title: ${yamlString(title)}
category: social
topic: ${yamlString(topic)}
tags: ${tagsStr}
contributors: ${contribStr}
author: ${yamlString(author)}
created: ${created}
updated: ${today}
---
`

  const summaryLine = summary ? `\n${summary}\n` : ''
  const body = `# ${title}\n${summaryLine}\n${content.trimEnd()}\n`

  await mkdir(join(socialRoot, topic), { recursive: true })
  await writeFile(filePath, frontmatter + '\n' + body, 'utf8')

  return {
    content: [{
      type: 'text',
      text: `Page written: pages/social/${topic}/${slug}.md (author ${author}, contributors: ${contributors.join(', ')})`,
    }],
  }
}
