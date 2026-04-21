import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { existsSync } from 'node:fs'
import * as Y from 'yjs'

const LOCAL_FILE_ORIGIN = 'local-file'

// Write a wiki page to disk, creating parent directories as needed
async function writePageFile(wikiDir, key, content) {
  const filePath = join(wikiDir, key)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

// Attach a change observer to a Y.Text page and write to disk on remote updates
function bridgeTextToFile(key, text, wikiDir) {
  text.observe((event) => {
    if (event.transaction.origin === LOCAL_FILE_ORIGIN) return
    const content = text.toString()
    writePageFile(wikiDir, key, content).catch((err) =>
      console.error(`[file-bridge] write error (${key}):`, err.message)
    )
  })
}

// Load all existing Markdown files in wikiDir into the Yjs doc at startup
async function loadFilesIntoDoc(wikiDir, doc, pages) {
  if (!existsSync(wikiDir)) return
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.name.endsWith('.md')) continue
      const key = relative(wikiDir, full)
      const content = await readFile(full, 'utf8')
      doc.transact(() => {
        if (!pages.has(key)) {
          const text = new Y.Text()
          text.insert(0, content)
          pages.set(key, text)
        }
        // If Yjs already has the page (from persisted state), trust Yjs
      }, LOCAL_FILE_ORIGIN)
    }
  }
  await walk(wikiDir)
}

/**
 * Create a bidirectional bridge between a Yjs doc and the wiki filesystem.
 *
 * Yjs → files: whenever a page changes in Yjs (from remote sync), write to disk.
 * Files → Yjs: whenever a .md file changes on disk (edit server, manual edit), update Yjs.
 *
 * @param {Y.Doc} doc
 * @param {Y.Map} pages
 * @param {string} wikiDir  - namespace directory, e.g. wiki/@darius
 * @returns {{ stop: () => void }}
 */
export async function createFileBridge(doc, pages, wikiDir) {
  await mkdir(wikiDir, { recursive: true })

  // Load existing files into Yjs (idempotent — won't overwrite persisted state)
  await loadFilesIntoDoc(wikiDir, doc, pages)

  // Attach observers to pages already in the doc (from persisted state)
  for (const [key, text] of pages.entries()) {
    if (text instanceof Y.Text) {
      bridgeTextToFile(key, text, wikiDir)
      // Write persisted content to disk if file is missing
      const filePath = join(wikiDir, key)
      if (!existsSync(filePath)) {
        await writePageFile(wikiDir, key, text.toString()).catch(() => {})
      }
    }
  }

  // Watch for new pages added to the Y.Map
  pages.observe((event) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add' || change.action === 'update') {
        const text = pages.get(key)
        if (!(text instanceof Y.Text)) continue
        bridgeTextToFile(key, text, wikiDir)
        // Write the initial content to disk
        writePageFile(wikiDir, key, text.toString()).catch((err) =>
          console.error(`[file-bridge] write error (${key}):`, err.message)
        )
      }
    }
  })

  // Watch filesystem for local edits (edit server, manual changes)
  const watcher = watch(wikiDir, { recursive: true }, async (_, filename) => {
    if (!filename?.endsWith('.md')) return
    const filePath = join(wikiDir, filename)
    if (!existsSync(filePath)) return

    try {
      const content = await readFile(filePath, 'utf8')

      // Skip if content already matches Yjs (we wrote this file)
      const existing = pages.get(filename)
      if (existing instanceof Y.Text && existing.toString() === content) return

      doc.transact(() => {
        let text = pages.get(filename)
        if (!text || !(text instanceof Y.Text)) {
          text = new Y.Text()
          pages.set(filename, text)
        }
        if (text.length > 0) text.delete(0, text.length)
        text.insert(0, content)
      }, LOCAL_FILE_ORIGIN)
    } catch {
      // File may have been removed or is still being written
    }
  })

  return {
    stop() { watcher.close() },
  }
}
