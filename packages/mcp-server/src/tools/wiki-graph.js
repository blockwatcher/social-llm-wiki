import { analyzeWiki } from '@social-llm-wiki/graph'

/**
 * wiki_graph — Return the knowledge graph for a namespace
 *
 * Returns nodes, edges, clusters and key metrics.
 * Use wiki_gaps for the gap analysis and research prompts.
 */
export async function wikiGraph({ wikiRoot, namespace = '' }) {
  const result = await analyzeWiki(wikiRoot, namespace)

  if (result.empty) {
    return { content: [{ type: 'text', text: `No pages found in namespace: "${namespace}"` }] }
  }

  const { gapReport } = result
  const lines = [
    `## Knowledge Graph — ${namespace || 'all namespaces'}`,
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Pages | ${result.pages} |`,
    `| Links | ${result.edges} |`,
    `| Clusters | ${result.clusters.length} |`,
    `| Orphan pages | ${gapReport.summary.orphanCount} |`,
    `| Gaps | ${gapReport.summary.gapCount} |`,
    `| Missing pages (dangling links) | ${gapReport.summary.danglingLinkCount} |`,
    `| Bridge pages | ${gapReport.summary.bridgeCount} |`,
    '',
    `### Cluster sizes`,
    result.clusters.map((size, i) => `- Cluster ${i + 1}: ${size} page(s)`).join('\n'),
  ]

  if (gapReport.bridges.length > 0) {
    lines.push('', '### Bridge pages (connect multiple clusters)')
    for (const b of gapReport.bridges) {
      lines.push(`- **${b.title || b.slug}** — connects ${b.connectsClusters} clusters`)
    }
  }

  if (gapReport.orphans.length > 0) {
    lines.push('', `### Orphan pages (${gapReport.orphans.length})`)
    for (const o of gapReport.orphans.slice(0, 8)) {
      lines.push(`- ${o.title || o.slug}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
