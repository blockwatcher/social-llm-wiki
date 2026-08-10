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
 * Safety: writes are hard-scoped to pages/social/<group>/, and <group> must be one
 * the server was configured to share. The resolved path must stay inside it — a
 * slug or folder containing `..` (or otherwise escaping) is rejected — so this tool
 * can never touch the rest of the wiki.
 *
 * Collaboration: `author` is the current editor; a `contributors` set in the
 * frontmatter accumulates everyone who has touched the page. `created` and `tags`
 * are preserved across edits.
 */

const SEG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // one path segment: lowercase, digits, hyphens

// Mirrors wiki-lint.py so this guard and the Sunday lint agree on what a
// wikilink is and on which page a given target resolves to.
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g
const UMLAUTS = { ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }

const yamlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+[—–-]\s+.*$/, '') // drop a subtitle after a dash
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

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
 * Index every page under `pages/` by filename stem.
 *
 * wiki-index.md and wiki-lint address pages by stem rather than by path, so the
 * stem is the wiki's real key — both the collision check and the wikilink check
 * below resolve against it. One walk serves both (no file contents are read).
 */
async function indexPageStems(pagesRoot) {
  const index = new Map()
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
      else if (entry.name.endsWith('.md')) {
        const stem = entry.name.slice(0, -3)
        if (!index.has(stem)) index.set(stem, [])
        index.get(stem).push(full)
      }
    }
  }
  return index
}

/** Resolve a wikilink target the way wiki-lint does: exact stem, else slugified. */
function resolveWikilink(index, target) {
  return index.get(target) ?? index.get(slugifyTitle(target)) ?? []
}

/**
 * Privacy policy for the shared branch.
 *
 * A shared page syncs to every peer in the group, so a [[wikilink]] pointing at a
 * page that lives elsewhere in the wiki is a link to a private page: it dangles on
 * the peer's side and exposes the page name. Those are rejected — mention such a
 * page as plain text instead. A target that resolves nowhere is allowed (it may be
 * written next) but reported back, since it is what the lint will flag.
 */
function checkWikilinks(content, index, groupRoot) {
  const inGroup = (p) => p === groupRoot || p.startsWith(groupRoot + sep)
  const leaked = new Map()
  const dangling = new Set()

  for (const m of stripCodeBlocks(content).matchAll(WIKILINK_RE)) {
    const target = m[1].trim()
    if (!target) continue
    const paths = resolveWikilink(index, target)
    if (paths.length === 0) dangling.add(target)
    else if (!paths.some(inGroup)) leaked.set(target, paths[0])
  }

  return { leaked, dangling: [...dangling] }
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
  group,
  allowedGroups,
}) {
  if (!author) {
    throw new Error('author is required — the caller supplies WIKI_AUTHOR')
  }
  if (!group) {
    throw new Error('group is required — the caller supplies WIKI_SHARED_GROUPS')
  }
  if (!SEG_RE.test(group)) {
    throw new Error(`invalid group "${group}" — lowercase letters, digits, hyphens only`)
  }
  // Each group is its own P2P sync namespace, so the allowlist is what keeps a
  // write from reaching a peer circle this deployment never joined.
  const allowed = allowedGroups?.length ? allowedGroups : [group]
  if (!allowed.includes(group)) {
    throw new Error(
      `group "${group}" is not shared by this server — allowed: ${allowed.join(', ')}`,
    )
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

  const groupRoot = resolve(wikiRoot, 'pages', 'social', group)
  const filePath = resolve(groupRoot, ...segments, `${slug}.md`)
  // Hard scope guard: the resolved path must live under pages/social/<group>/.
  if (filePath !== groupRoot && !filePath.startsWith(groupRoot + sep)) {
    throw new Error(`refusing to write outside pages/social/${group}/`)
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

  const stems = await indexPageStems(resolve(wikiRoot, 'pages'))

  if (isNew) {
    const collision = (stems.get(slug) ?? []).find((p) => p !== filePath)
    if (collision) {
      const prefix = segments[segments.length - 1] ?? group
      throw new Error(
        `slug "${slug}" is already taken by ${relative(wikiRoot, collision)} — the wiki index ` +
        `keys pages by filename, so the two would collide and one would drop out. ` +
        `Use a more specific slug, e.g. "${prefix}-${slug}".`,
      )
    }
  }

  const { leaked, dangling } = checkWikilinks(content, stems, groupRoot)
  if (leaked.size > 0) {
    const list = [...leaked].map(([t, p]) => `[[${t}]] → ${relative(wikiRoot, p)}`).join(', ')
    throw new Error(
      `refusing to link private pages from the shared branch: ${list}. ` +
      `This page syncs to every peer in "${group}", where such a link dangles and leaks ` +
      `the page name. Name the page as plain text instead of a [[wikilink]].`,
    )
  }

  const tagsStr = effectiveTags.length ? `[${effectiveTags.map((t) => `"${t}"`).join(', ')}]` : '[]'
  const contribStr = `[${contributors.map((c) => `"${c}"`).join(', ')}]`

  const frontmatter = `---
title: ${yamlString(title)}
category: social
group: ${yamlString(group)}
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

  const note = dangling.length
    ? `\nNote: ${dangling.map((t) => `[[${t}]]`).join(', ')} ${dangling.length === 1 ? 'resolves' : 'resolve'} ` +
      `to no page yet — write ${dangling.length === 1 ? 'it' : 'them'} into the group, or use plain text.`
    : ''

  return {
    content: [{
      type: 'text',
      text: `Page written: pages/social/${group}/${relDir}${slug}.md ` +
        `(author ${author}, contributors: ${contributors.join(', ')})${note}`,
    }],
  }
}
