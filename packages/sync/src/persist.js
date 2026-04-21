import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import * as Y from 'yjs'

function stateFile(stateDir, namespace) {
  const slug = namespace.replace(/[^a-z0-9]/gi, '_')
  return join(stateDir, `${slug}.bin`)
}

export async function loadState(doc, stateDir, namespace) {
  const file = stateFile(stateDir, namespace)
  if (!existsSync(file)) return
  try {
    const data = await readFile(file)
    Y.applyUpdate(doc, data, 'persist')
    console.log(`[sync] loaded persisted state (${data.length} bytes)`)
  } catch (err) {
    console.error('[sync] could not load persisted state:', err.message)
  }
}

export async function saveState(doc, stateDir, namespace) {
  await mkdir(stateDir, { recursive: true })
  const file = stateFile(stateDir, namespace)
  const state = Y.encodeStateAsUpdate(doc)
  await writeFile(file, state)
}

// Returns a debounced save function (waits 2s after last update)
export function makeDebouncedSave(doc, stateDir, namespace) {
  let timer = null
  return function scheduleSave() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      saveState(doc, stateDir, namespace).catch((err) =>
        console.error('[sync] persist error:', err.message)
      )
    }, 2000)
  }
}
