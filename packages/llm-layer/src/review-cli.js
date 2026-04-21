#!/usr/bin/env node
/**
 * Usage: node packages/llm-layer/src/review-cli.js [wikiRoot]
 * Default wikiRoot: ./wiki
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */
import { runReview } from './review.js'
import { resolve } from 'node:path'

const wikiRoot = resolve(process.env.WIKI_ROOT ?? process.argv[2] ?? './wiki')
const namespace = process.env.WIKI_NAMESPACE ?? '@darius'

const { promoted, skipped } = await runReview({ wikiRoot, namespace })

console.log(`\nDone: ${promoted.length} promoted, ${skipped.length} skipped`)
