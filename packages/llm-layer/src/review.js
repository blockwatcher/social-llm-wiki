import Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'

const client = new Anthropic()

const REVIEW_SYSTEM_PROMPT = `You are Kai, a personal wiki assistant. Your task is to review inbox entries and decide which ones are worth keeping in the long-term wiki.

For each inbox entry you receive, you will:
1. Assess whether it contains information worth preserving long-term (skip ephemeral/trivial content)
2. If worth keeping: write a polished, well-linked wiki candidate page
3. If not worth keeping: skip it

Output a JSON array. Each element is either:
- { "action": "promote", "filename": "<original inbox filename>", "content": "<full markdown page>" }
- { "action": "skip", "filename": "<original inbox filename>", "reason": "<one sentence why>" }

For promoted pages, the content must:
- Have clean YAML frontmatter (title, tags, wikilinks array)
- Be concise and well-structured
- Use [[wikilinks]] to related concepts
- Include a "## Related" section

Output only the JSON array, no preamble.`

async function readInboxEntries(inboxDir) {
  const entries = []
  if (!existsSync(inboxDir)) return entries

  const channels = await readdir(inboxDir, { withFileTypes: true })
  for (const ch of channels) {
    if (!ch.isDirectory()) continue
    const channelDir = join(inboxDir, ch.name)
    const files = await readdir(channelDir)
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const filePath = join(channelDir, f)
      const s = await stat(filePath)
      const content = await readFile(filePath, 'utf8')
      // Skip already-promoted entries
      if (content.includes('promoted: true')) continue
      entries.push({
        filename: `${ch.name}/${f}`,
        filePath,
        content,
        mtime: s.mtimeMs,
      })
    }
  }

  return entries.sort((a, b) => b.mtime - a.mtime)
}

async function markPromoted(filePath) {
  const content = await readFile(filePath, 'utf8')
  const updated = content.replace(/^promoted: false/m, 'promoted: true')
  await writeFile(filePath, updated, 'utf8')
}

/**
 * Run the LLM review loop: read inbox entries, decide what goes to review/.
 *
 * @param {object} opts
 * @param {string} opts.wikiRoot
 * @param {string} [opts.namespace]
 * @param {number} [opts.maxEntries] - Max inbox entries to review per run (default: 20)
 * @returns {Promise<{ promoted: string[], skipped: string[] }>}
 */
export async function runReview({ wikiRoot, namespace = '@darius', maxEntries = 20 }) {
  const inboxDir = join(wikiRoot, 'inbox')
  const reviewDir = join(wikiRoot, 'review', 'candidates')
  await mkdir(reviewDir, { recursive: true })

  const entries = await readInboxEntries(inboxDir)
  const batch = entries.slice(0, maxEntries)

  if (batch.length === 0) {
    console.log('[review] inbox empty — nothing to review')
    return { promoted: [], skipped: [] }
  }

  console.log(`[review] reviewing ${batch.length} inbox entries`)

  // Build user message with all entries
  const userContent = batch.map((e, i) =>
    `### Entry ${i + 1}: ${e.filename}\n\n${e.content}`
  ).join('\n\n---\n\n')

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8192,
    system: [
      {
        type: 'text',
        text: REVIEW_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
  })

  const raw = response.content.find((b) => b.type === 'text')?.text ?? '[]'

  let decisions
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    decisions = JSON.parse(cleaned)
  } catch {
    console.error('[review] failed to parse LLM response:', raw.slice(0, 200))
    return { promoted: [], skipped: [] }
  }

  const promoted = []
  const skipped = []
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)

  for (const decision of decisions) {
    const entry = batch.find((e) => e.filename === decision.filename)
    if (!entry) continue

    if (decision.action === 'promote') {
      // Write candidate to review/candidates/
      const slug = decision.filename
        .replace(/\//g, '-')
        .replace(/\.md$/, '')
        .slice(0, 60)
      const candidateFile = join(reviewDir, `${dateStr}-${slug}.md`)

      // Inject review metadata into frontmatter
      const reviewMeta = `reviewed: ${now.toISOString()}\nsource: ${entry.filename}\nnamespace: ${namespace}\napproved: false`
      const content = decision.content.startsWith('---\n')
        ? decision.content.replace(/^---\n/, `---\n${reviewMeta}\n`)
        : `---\n${reviewMeta}\n---\n\n${decision.content}`

      await writeFile(candidateFile, content, 'utf8')
      await markPromoted(entry.filePath)

      promoted.push(decision.filename)
      console.log(`[review] promoted: ${decision.filename} → review/candidates/`)
    } else {
      skipped.push(decision.filename)
      console.log(`[review] skipped: ${decision.filename} (${decision.reason})`)
    }
  }

  return { promoted, skipped }
}
