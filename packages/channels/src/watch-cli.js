#!/usr/bin/env node
/**
 * Usage: node packages/channels/src/watch-cli.js [dropDir] [wikiRoot]
 *
 * Defaults:
 *   dropDir  = ./drop
 *   wikiRoot = ./wiki
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */
import { startFileWatch } from './file-watch.js'
import { resolve } from 'node:path'

const dropDir = resolve(process.argv[2] ?? './drop')
const wikiRoot = resolve(process.argv[3] ?? './wiki')

const ac = new AbortController()
process.on('SIGINT', () => ac.abort())
process.on('SIGTERM', () => ac.abort())

await startFileWatch({ dropDir, wikiRoot, signal: ac.signal })
