import Anthropic from '@anthropic-ai/sdk'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const client = new Anthropic()

// Cached: stable across all ingest calls — only changes when we update the prompt
const SYSTEM_PROMPT = `You are Kai, a personal wiki assistant. Transform raw input into a structured wiki page.

Output a Markdown document with:
1. YAML frontmatter: title (string), tags (array of lowercase strings), schema (one of: text/note, text/article, text/transcript, geo/track, geo/poi, media/photo)
2. A concise one-paragraph summary
3. Key sections with ## headings (extract the most important information)
4. A "## Related" section with [[wikilinks]] to concepts that deserve their own wiki page

Rules:
- Use [[concept]] wikilink syntax for related concepts
- Be dense and concise — prefer linked pages over verbose prose
- Title must be specific and searchable
- 3–8 tags, lowercase
- Do NOT include operational fields (channel, author, ingested, ttl, promoted) — those are added automatically
- Output only the Markdown document, no preamble`

function slugify(text) {
  return (text || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function dateParts(now) {
  return {
    dateStr: now.toISOString().slice(0, 10),
    timeStr: now.toISOString().slice(11, 19).replace(/:/g, '-'),
  }
}

export async function ingest(raw, options = {}) {
  const { wikiRoot, channel = 'notes', namespace = '@darius', title = '', tags = [] } = options

  const now = new Date()
  const { dateStr, timeStr } = dateParts(now)
  const slug = slugify(title || 'entry')
  const filename = `${dateStr}-${timeStr}-${slug}.md`

  // 1. Write original source to raw/text/ (permanent, never processed by LLM directly)
  let rawPath = null
  if (wikiRoot) {
    const rawDir = join(wikiRoot, 'raw', 'text')
    await mkdir(rawDir, { recursive: true })
    rawPath = join('raw', 'text', filename)
    await writeFile(join(wikiRoot, rawPath), raw, 'utf8')
  }

  // 2. Call Claude to structure the content
  const userContent = [
    title && `Title hint: ${title}`,
    tags.length && `Tags hint: ${tags.join(', ')}`,
    `Channel: ${channel}`,
    '',
    '---',
    '',
    raw,
  ].filter(Boolean).join('\n')

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // cached across repeated ingest calls
      },
    ],
    messages: [{ role: 'user', content: userContent }],
  })

  const structured = response.content.find((b) => b.type === 'text')?.text ?? ''

  // 3. Inject operational frontmatter and write to inbox/
  const rawRef = rawPath ? `\nraw: ${rawPath}` : ''
  const operationalFrontmatter = `channel: ${channel}\nauthor: ${namespace}\ningested: ${now.toISOString()}\nttl: 30d\npromoted: false${rawRef}`

  const finalContent = structured.startsWith('---\n')
    ? structured.replace(/^---\n/, `---\n${operationalFrontmatter}\n`)
    : `---\n${operationalFrontmatter}\n---\n\n${structured}`

  let inboxPath = null
  if (wikiRoot) {
    const inboxDir = join(wikiRoot, 'inbox', channel)
    await mkdir(inboxDir, { recursive: true })
    inboxPath = join('inbox', channel, filename)
    await writeFile(join(wikiRoot, inboxPath), finalContent, 'utf8')
  }

  return { inboxPath, rawPath, structured: finalContent }
}
