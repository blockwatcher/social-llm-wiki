/**
 * Gap analysis — find structural gaps in the knowledge graph.
 *
 * A "gap" is a pair of clusters that share no connecting links.
 * Gaps represent opportunities for new insights or research questions.
 * This is the core of the InfraNodus approach.
 */

/**
 * Analyze the graph for gaps and generate prompts for Kai.
 *
 * @param {{ nodes, clusters, orphans, dangling, bridges }} graph
 * @returns {GapReport}
 */
export function analyzeGaps({ nodes, clusters, orphans, dangling, bridges }) {
  const gaps = findGaps(nodes, clusters)
  const suggestions = generateSuggestions(gaps, clusters, nodes)
  const lintIssues = lint(orphans, dangling)

  return {
    summary: {
      totalPages: nodes.size,
      totalClusters: clusters.length,
      orphanCount: orphans.length,
      danglingLinkCount: dangling.length,
      gapCount: gaps.length,
      bridgeCount: bridges.length,
    },
    gaps,
    suggestions,
    orphans,
    dangling: dangling.slice(0, 10),  // top 10 missing pages
    bridges: bridges.slice(0, 5),
    lintIssues,
  }
}

/**
 * Find gaps between clusters — pairs of clusters with no connecting page.
 */
function findGaps(nodes, clusters) {
  if (clusters.length < 2) return []

  // Get representative topics per cluster (highest-degree nodes)
  const clusterTopics = clusters.map((cluster) => {
    const ranked = cluster
      .map((slug) => nodes.get(slug))
      .filter(Boolean)
      .sort((a, b) => b.degree - a.degree)
    return ranked.slice(0, 3).map((n) => n.title || n.slug)
  })

  // Check which cluster pairs are connected
  const clusterOf = new Map()
  clusters.forEach((cluster, i) => cluster.forEach((slug) => clusterOf.set(slug, i)))

  const connectedPairs = new Set()
  for (const node of nodes.values()) {
    for (const neighbor of [...node.outLinks, ...node.inLinks]) {
      const c1 = clusterOf.get(node.slug)
      const c2 = clusterOf.get(neighbor)
      if (c1 !== undefined && c2 !== undefined && c1 !== c2) {
        const key = [Math.min(c1, c2), Math.max(c1, c2)].join('-')
        connectedPairs.add(key)
      }
    }
  }

  const gaps = []
  for (let i = 0; i < Math.min(clusters.length, 8); i++) {
    for (let j = i + 1; j < Math.min(clusters.length, 8); j++) {
      const key = `${i}-${j}`
      if (!connectedPairs.has(key)) {
        gaps.push({
          clusterA: { index: i, size: clusters[i].length, topics: clusterTopics[i] },
          clusterB: { index: j, size: clusters[j].length, topics: clusterTopics[j] },
          prompt: gapPrompt(clusterTopics[i], clusterTopics[j]),
        })
      }
    }
  }

  return gaps.slice(0, 6)  // top 6 gaps
}

function gapPrompt(topicsA, topicsB) {
  const a = topicsA.slice(0, 2).join(', ')
  const b = topicsB.slice(0, 2).join(', ')
  return `Based on the gap between the "${a}" cluster and the "${b}" cluster: ` +
    `what connection or insight bridges these two areas? ` +
    `Generate a research question or a new wiki page that links them.`
}

function generateSuggestions(gaps, clusters, nodes) {
  const suggestions = []

  // Suggest creating bridge pages for top gaps
  for (const gap of gaps.slice(0, 3)) {
    suggestions.push({
      type: 'bridge-page',
      priority: 'high',
      description: `Create a page connecting "${gap.clusterA.topics[0]}" and "${gap.clusterB.topics[0]}"`,
      prompt: gap.prompt,
    })
  }

  // Suggest expanding small isolated clusters
  const smallClusters = clusters.filter((c) => c.length === 1)
  if (smallClusters.length > 3) {
    suggestions.push({
      type: 'expand-isolated',
      priority: 'medium',
      description: `${smallClusters.length} isolated pages have no links — add connections or merge into related pages`,
      pages: smallClusters.flat().slice(0, 5).map((s) => nodes.get(s)?.title || s),
    })
  }

  return suggestions
}

/**
 * Lint the wiki for structural issues.
 */
function lint(orphans, dangling) {
  const issues = []

  if (orphans.length > 0) {
    issues.push({
      type: 'orphan-pages',
      severity: 'warning',
      count: orphans.length,
      message: `${orphans.length} page(s) have no links in or out — they are invisible in the graph`,
      examples: orphans.slice(0, 5).map((o) => o.title || o.slug),
    })
  }

  if (dangling.length > 0) {
    issues.push({
      type: 'missing-pages',
      severity: 'info',
      count: dangling.length,
      message: `${dangling.length} wikilink target(s) don't exist yet — candidates for new pages`,
      examples: dangling.slice(0, 5).map((d) => d.target),
    })
  }

  return issues
}
