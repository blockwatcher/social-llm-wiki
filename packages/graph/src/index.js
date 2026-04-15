/**
 * Social LLM Wiki — Knowledge Graph
 *
 * Analyzes the wiki's link structure to find clusters, gaps, orphans,
 * and bridge pages. The gap analysis is the core feature — it identifies
 * unconnected areas of knowledge and generates prompts for Kai to explore.
 *
 * CLI usage:
 *   WIKI_ROOT=./wiki node packages/graph/src/index.js [@darius]
 */

import { parseWiki } from './parse.js'
import { buildGraph, findClusters, findOrphans, findDanglingLinks, findBridges } from './graph.js'
import { analyzeGaps } from './gaps.js'
import { resolve } from 'node:path'

export { parseWiki } from './parse.js'
export { buildGraph, findClusters, findOrphans, findDanglingLinks, findBridges } from './graph.js'
export { analyzeGaps } from './gaps.js'

/**
 * Run a full graph analysis on a wiki namespace.
 * This is the main entry point used by the MCP server tools.
 *
 * @param {string} wikiRoot
 * @param {string} namespace
 * @returns {Promise<FullAnalysis>}
 */
export async function analyzeWiki(wikiRoot, namespace = '') {
  const pages = await parseWiki(wikiRoot, namespace)
  if (pages.length === 0) {
    return { empty: true, namespace, wikiRoot }
  }

  const { nodes, edges } = buildGraph(pages)
  const clusters = findClusters(nodes)
  const orphans = findOrphans(nodes)
  const dangling = findDanglingLinks(pages, nodes)
  const bridges = findBridges(nodes, clusters)
  const gapReport = analyzeGaps({ nodes, clusters, orphans, dangling, bridges })

  return {
    namespace,
    pages: pages.length,
    edges: edges.size,
    clusters: clusters.map((c) => c.length),
    nodes: Object.fromEntries(nodes),
    gapReport,
  }
}

// CLI entry point
if (process.argv[1] === resolve(import.meta.url.replace('file://', ''))) {
  const wikiRoot = resolve(process.env.WIKI_ROOT ?? './wiki')
  const namespace = process.argv[2] ?? ''

  const result = await analyzeWiki(wikiRoot, namespace)

  if (result.empty) {
    console.log(`No pages found in ${namespace || 'wiki root'}`)
    process.exit(0)
  }

  const { gapReport } = result
  console.log('\n=== Knowledge Graph Analysis ===\n')
  console.log(`Pages: ${result.pages}  |  Links: ${result.edges}  |  Clusters: ${result.clusters.length}`)
  console.log(`Orphans: ${gapReport.summary.orphanCount}  |  Gaps: ${gapReport.summary.gapCount}  |  Missing pages: ${gapReport.summary.danglingLinkCount}`)

  if (gapReport.gaps.length > 0) {
    console.log('\n--- Gaps (unconnected clusters) ---')
    for (const gap of gapReport.gaps) {
      console.log(`\n  Gap: "${gap.clusterA.topics[0]}" ↔ "${gap.clusterB.topics[0]}"`)
      console.log(`  → ${gap.prompt}`)
    }
  }

  if (gapReport.lintIssues.length > 0) {
    console.log('\n--- Lint Issues ---')
    for (const issue of gapReport.lintIssues) {
      console.log(`  [${issue.severity}] ${issue.message}`)
    }
  }

  if (gapReport.suggestions.length > 0) {
    console.log('\n--- Suggestions ---')
    for (const s of gapReport.suggestions) {
      console.log(`  [${s.priority}] ${s.description}`)
    }
  }

  console.log('')
}
