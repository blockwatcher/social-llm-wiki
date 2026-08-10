import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
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

// Load all existing Markdown files in wikiDir into the Yjs doc at startup.
// Returns every .md key found on disk — including gated ones, which exist locally
// even though they are not published.
async function loadFilesIntoDoc(wikiDir, doc, pages, gate) {
  const onDisk = new Set()
  if (!existsSync(wikiDir)) return onDisk
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.name.endsWith('.md')) continue
      const key = relative(wikiDir, full)
      onDisk.add(key)
      const content = await readFile(full, 'utf8')
      // A page that was edited while the node was down must be gated here too —
      // otherwise it would be published on the next restart.
      if (await gate(key, content)) continue
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
  return onDisk
}

/**
 * Create a bidirectional bridge between a Yjs doc and the wiki filesystem.
 *
 * Yjs → files: whenever a page changes in Yjs (from remote sync), write to disk; when a
 *              peer removes a page, remove the local file.
 * Files → Yjs: whenever a .md file changes on disk (edit server, manual edit), update
 *              Yjs; when a file is removed, remove the page from the doc. Deletions are
 *              confirmed after a grace period, and a local deletion made while the node
 *              was down is reconciled at startup.
 *
 * Publication is one-way-gated: `gate` decides whether a LOCAL page may enter the doc
 * (and thus reach peers). Pages arriving FROM peers are never gated — the concern is
 * what leaves this machine, not what reaches it. A page refused by the gate keeps its
 * local file untouched; if the page was already published, peers simply keep the last
 * version that passed.
 *
 * @param {Y.Doc} doc
 * @param {Y.Map} pages
 * @param {string} wikiDir  - namespace directory, e.g. wiki/@darius
 * @param {object} [opts]
 * @param {(key: string, content: string) => Promise<string|null>} [opts.gate]
 *        Reason to withhold the page, or null to publish. Default: publish everything.
 * @param {(key: string, reason: string) => void} [opts.onBlocked]
 *        Called when the gate withholds a page (deduplicated per key+reason).
 * @param {(key: string) => void} [opts.onDeleted]
 *        Called when a local deletion is propagated to the doc (and thus to peers).
 * @param {number} [opts.deleteGraceMs]
 *        How long a file may stay missing before it counts as deleted. Default 3000.
 * @returns {{ stop: () => void }}
 */
export async function createFileBridge(doc, pages, wikiDir, opts = {}) {
  const gate = opts.gate ?? (() => null)
  const onBlocked = opts.onBlocked ?? (() => {})
  const onDeleted = opts.onDeleted ?? (() => {})
  const deleteGraceMs = opts.deleteGraceMs ?? 3000
  // The gate re-evaluates on every filesystem event, so without this a single withheld
  // page would re-report on every save.
  const reported = new Map()
  const report = (key, reason) => {
    if (reported.get(key) === reason) return
    reported.set(key, reason)
    onBlocked(key, reason)
  }

  await mkdir(wikiDir, { recursive: true })

  // Load existing files into Yjs (idempotent — won't overwrite persisted state)
  const onDisk = await loadFilesIntoDoc(wikiDir, doc, pages, async (key, content) => {
    const reason = await gate(key, content)
    if (reason) report(key, reason)
    return reason
  })

  // Reconcile persisted state against disk. At this point the doc holds only our own
  // persisted state — the node has not connected to any peer yet — so a page that is
  // in the doc but not on disk was deleted locally while we were down.
  //
  // Exception: an empty directory alongside a non-empty doc is far more likely to be a
  // wiki that has not been materialized yet (fresh checkout, moved data dir) than a
  // deliberate deletion of everything. Restoring is the recoverable mistake there;
  // propagating the deletion to every peer is not.
  const wipedOut = onDisk.size === 0 && pages.size > 0
  if (wipedOut) {
    console.warn(
      `[file-bridge] ${pages.size} page(s) in state but none on disk — restoring from ` +
      'state instead of propagating deletions',
    )
  }

  for (const [key, text] of pages.entries()) {
    if (!(text instanceof Y.Text)) continue
    bridgeTextToFile(key, text, wikiDir)
    if (onDisk.has(key)) continue

    if (wipedOut) {
      await writePageFile(wikiDir, key, text.toString()).catch(() => {})
    } else {
      doc.transact(() => pages.delete(key), LOCAL_FILE_ORIGIN)
      onDeleted(key)
    }
  }

  // Watch for pages added, updated or removed in the Y.Map
  pages.observe((event) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'delete') {
        // Our own deletions already happened on disk; only mirror a peer's.
        if (event.transaction.origin === LOCAL_FILE_ORIGIN) continue
        rm(join(wikiDir, key), { force: true }).catch((err) =>
          console.error(`[file-bridge] delete error (${key}):`, err.message)
        )
        continue
      }
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

  // A deletion is confirmed only after a grace period: tools that save by writing a
  // temporary file and renaming it over the target make the page briefly absent, and
  // treating that as a deletion would drop the page for every peer.
  const pendingDeletes = new Map()
  const cancelDelete = (key) => {
    const timer = pendingDeletes.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    pendingDeletes.delete(key)
  }
  const scheduleDelete = (key) => {
    cancelDelete(key)
    pendingDeletes.set(key, setTimeout(() => {
      pendingDeletes.delete(key)
      if (existsSync(join(wikiDir, key))) return // came back — it was a save, not a delete
      if (!pages.has(key)) return
      doc.transact(() => pages.delete(key), LOCAL_FILE_ORIGIN)
      reported.delete(key)
      onDeleted(key)
    }, deleteGraceMs))
  }

  // Watch filesystem for local edits (edit server, manual changes)
  const watcher = watch(wikiDir, { recursive: true }, async (_, filename) => {
    if (!filename?.endsWith('.md')) return
    const filePath = join(wikiDir, filename)
    if (!existsSync(filePath)) {
      scheduleDelete(filename)
      return
    }
    cancelDelete(filename)

    try {
      const content = await readFile(filePath, 'utf8')

      // Skip if content already matches Yjs (we wrote this file)
      const existing = pages.get(filename)
      if (existing instanceof Y.Text && existing.toString() === content) return

      const blocked = await gate(filename, content)
      if (blocked) {
        report(filename, blocked)
        return
      }
      reported.delete(filename) // passed again — a later block should re-report

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
    stop() {
      watcher.close()
      for (const timer of pendingDeletes.values()) clearTimeout(timer)
      pendingDeletes.clear()
    },
  }
}
