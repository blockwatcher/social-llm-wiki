import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/**
 * wiki_write_page — Create or update a page in a shared wiki group.
 *
 * Writes DIRECTLY into pages/social/<group>/, the collaboratively-synced area
 * (default group: darius-lukas). Any topic is allowed — organize freely with an
 * optional subfolder. Each group under social/ is its own P2P sync namespace, so
 * pages here reach that group's peers and nothing else.
 *
 * Safety: writes are hard-scoped to pages/social/<group>/. The resolved path must
 * stay inside it — a slug or folder containing `..` (or otherwise escaping) is
 * rejected — so this tool can never touch the rest of the wiki.
 *
 * Collaboration: `author` is the current editor; a `contributors` set in the
 * frontmatter accumulates everyone who has touched the page. `created` and `tags`
 * are preserved across edits.
 */

const GROUP = process.env.WIKI_SHARED_GROUP || 'darius-lukas'
const SEG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // one path segment: lowercase, digits, hyphens

const yamlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function extractField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim() : null
}

function extractList(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'))
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}

export async function wikiWritePage({
  wikiRoot,
  slug,
  title,
  content,
  folder = '',
  tags = [],
  author = '@darius',
  summary = '',
}) {
  if (typeof slug !== 'string' || !SEG_RE.test(slug)) {
    throw new Error(`invalid slug "${slug}" — use lowercase letters, digits and hyphens only`)
  }
  const segments = String(folder || '').split('/').map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    if (!SEG_RE.test(seg)) {
      throw new Error(`invalid folder segment "${seg}" — lowercase letters, digits, hyphens only`)
    }
  }
  if (!title || !content) {
    throw new Error('title and content are required')
  }

  const groupRoot = resolve(wikiRoot, 'pages', 'social', GROUP)
  const filePath = resolve(groupRoot, ...segments, `${slug}.md`)
  // Hard scope guard: the resolved path must live under pages/social/<group>/.
  if (filePath !== groupRoot && !filePath.startsWith(groupRoot + sep)) {
    throw new Error(`refusing to write outside pages/social/${GROUP}/`)
  }

  const today = new Date().toISOString().slice(0, 10)

  // Preserve created + tags + accumulate contributors across edits.
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

  const tagsStr = effectiveTags.length ? `[${effectiveTags.map((t) => `"${t}"`).join(', ')}]` : '[]'
  const contribStr = `[${contributors.map((c) => `"${c}"`).join(', ')}]`

  const frontmatter = `---
title: ${yamlString(title)}
category: social
group: ${yamlString(GROUP)}
tags: ${tagsStr}
contributors: ${contribStr}
author: ${yamlString(author)}
created: ${created}
updated: ${today}
---
`

  const summaryLine = summary ? `\n${summary}\n` : ''
  const body = `# ${title}\n${summaryLine}\n${content.trimEnd()}\n`

  const relDir = segments.length ? `${segments.join('/')}/` : ''
  await mkdir(resolve(groupRoot, ...segments), { recursive: true })
  await writeFile(filePath, frontmatter + '\n' + body, 'utf8')

  return {
    content: [{
      type: 'text',
      text: `Page written: pages/social/${GROUP}/${relDir}${slug}.md (author ${author}, contributors: ${contributors.join(', ')})`,
    }],
  }
}
