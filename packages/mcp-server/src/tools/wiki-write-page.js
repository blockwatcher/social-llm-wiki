import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

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

/**
 * wiki-index.md and wiki-lint key pages by filename stem, not by path, so two
 * pages named `uebersicht.md` in different folders collide and one silently
 * drops out of the index. New pages are checked against the whole `pages/` tree;
 * updates are fine by construction (the stem is already theirs).
 */
async function findStemCollision(pagesRoot, slug, selfPath) {
  const stack = [pagesRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // pages/ (or a subfolder) may not exist yet
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === `${slug}.md` && full !== selfPath) return full
    }
  }
  return null
}

export async function wikiWritePage({
  wikiRoot,
  slug,
  title,
  content,
  folder = '',
  tags = [],
  author,
  summary = '',
}) {
  if (!author) {
    throw new Error('author is required — the caller supplies WIKI_AUTHOR')
  }
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
  let isNew = false
  try {
    const existing = await readFile(filePath, 'utf8')
    const fm = existing.slice(0, existing.indexOf('\n---', 4) + 4)
    created = extractField(fm, 'created') || created
    contributors = extractList(fm, 'contributors')
    if (!tags || tags.length === 0) effectiveTags = extractList(fm, 'tags')
  } catch {
    isNew = true
  }
  if (!contributors.includes(author)) contributors.push(author)

  if (isNew) {
    const collision = await findStemCollision(resolve(wikiRoot, 'pages'), slug, filePath)
    if (collision) {
      const prefix = segments[segments.length - 1] ?? GROUP
      throw new Error(
        `slug "${slug}" is already taken by ${relative(wikiRoot, collision)} — the wiki index ` +
        `keys pages by filename, so the two would collide and one would drop out. ` +
        `Use a more specific slug, e.g. "${prefix}-${slug}".`,
      )
    }
  }

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
