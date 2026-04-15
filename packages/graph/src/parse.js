import { readdir, readFile } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'
import { existsSync } from 'node:fs'

// Matches [[wikilink]], [[wikilink|alias]], [[wikilink#anchor]]
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g

// Matches # Heading at any level for title extraction
const HEADING_RE = /^#{1,3}\s+(.+)$/m

// Matches frontmatter title: field
const FRONTMATTER_TITLE_RE = /^title:\s*(.+)$/m

/**
 * Parse all Markdown files in a directory tree.
 * Returns a list of page objects with links and metadata.
 *
 * @param {string} wikiRoot
 * @param {string} namespace  - subfolder, e.g. "@darius" or "" for all
 * @returns {Promise<Page[]>}
 */
export async function parseWiki(wikiRoot, namespace = '') {
  const base = join(wikiRoot, namespace)
  if (!existsSync(base)) return []

  const files = await collectMarkdown(base, base)
  const pages = []

  for (const { relPath, content } of files) {
    const slug = relPath.replace(/\.md$/, '')
    const title = extractTitle(content, slug)
    const links = extractLinks(content)
    const wordCount = content.replace(/^---[\s\S]*?---/, '').trim().split(/\s+/).length
    const tags = extractTags(content)

    pages.push({ slug, relPath, title, links, wordCount, tags })
  }

  return pages
}

function extractTitle(content, fallback) {
  const fm = content.match(FRONTMATTER_TITLE_RE)
  if (fm) return fm[1].trim()
  const h = content.match(HEADING_RE)
  if (h) return h[1].trim()
  return fallback
}

function extractLinks(content) {
  // Strip frontmatter and code blocks before extracting links
  const stripped = content
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
  const links = new Set()
  for (const m of stripped.matchAll(WIKILINK_RE)) {
    links.add(m[1].trim().toLowerCase().replace(/\s+/g, '-'))
  }
  return [...links]
}

function extractTags(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const tagsLine = fm[1].match(/^tags:\s*\[([^\]]*)\]/m)
  if (tagsLine) {
    return tagsLine[1].split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean)
  }
  return []
}

async function collectMarkdown(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectMarkdown(full, base))
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(full, 'utf8')
      results.push({ relPath: relative(base, full), content })
    }
  }
  return results
}
