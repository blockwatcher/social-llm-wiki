import { watch, readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { ingest } from '@social-llm-wiki/llm-layer'

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown'])

// Detect channel schema from file extension / content hints
function detectSchema(filename) {
  const ext = extname(filename).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'text/note'
  return 'text/note'
}

async function processFile(filePath, { wikiRoot, namespace, doneDir }) {
  const filename = basename(filePath)
  const content = await readFile(filePath, 'utf8')

  // Use filename (without extension) as title hint
  const title = basename(filename, extname(filename)).replace(/[-_]+/g, ' ')
  const schema = detectSchema(filename)

  console.log(`[file-watch] ingesting: ${filename}`)

  const result = await ingest(content, {
    wikiRoot,
    channel: 'files',
    namespace,
    title,
    tags: [schema.replace('/', '-')],
  })

  console.log(`[file-watch] → ${result.inboxPath}`)

  // Move processed file to done/
  await mkdir(doneDir, { recursive: true })
  await rename(filePath, join(doneDir, filename))

  return result
}

/**
 * Watch a drop directory for new text files and ingest them automatically.
 *
 * @param {object} opts
 * @param {string} opts.dropDir    - Directory to watch for dropped files
 * @param {string} opts.wikiRoot   - Wiki root directory
 * @param {string} [opts.namespace]  - User namespace (default: '@darius')
 * @param {AbortSignal} [opts.signal] - AbortSignal to stop watching
 * @returns {Promise<void>} Resolves when the watcher is stopped
 */
export async function startFileWatch({ dropDir, wikiRoot, namespace = '@darius', signal }) {
  await mkdir(dropDir, { recursive: true })
  const doneDir = join(dropDir, '.done')

  console.log(`[file-watch] watching: ${dropDir}`)

  // Process any files already in the drop dir at startup
  const { readdir } = await import('node:fs/promises')
  const existing = await readdir(dropDir)
  for (const name of existing) {
    if (name.startsWith('.')) continue
    const ext = extname(name).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue
    const filePath = join(dropDir, name)
    try {
      await processFile(filePath, { wikiRoot, namespace, doneDir })
    } catch (err) {
      console.error(`[file-watch] error processing ${name}:`, err.message)
    }
  }

  // Watch for new files
  try {
    const watcher = watch(dropDir, { signal })
    for await (const event of watcher) {
      if (event.eventType !== 'rename' || !event.filename) continue
      if (event.filename.startsWith('.')) continue

      const ext = extname(event.filename).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue

      const filePath = join(dropDir, event.filename)

      // Small delay — ensure the file is fully written before reading
      await new Promise((r) => setTimeout(r, 200))
      if (!existsSync(filePath)) continue

      try {
        await processFile(filePath, { wikiRoot, namespace, doneDir })
      } catch (err) {
        console.error(`[file-watch] error processing ${event.filename}:`, err.message)
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  }

  console.log('[file-watch] stopped')
}
