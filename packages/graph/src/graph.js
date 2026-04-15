/**
 * Build and analyze a knowledge graph from parsed wiki pages.
 *
 * Nodes  = wiki pages (slugs)
 * Edges  = wikilinks between pages
 */

/**
 * Build an adjacency map from parsed pages.
 *
 * @param {Page[]} pages
 * @returns {{ nodes: Map, edges: Set }}
 */
export function buildGraph(pages) {
  const nodes = new Map()   // slug → { title, wordCount, tags, degree }
  const edges = new Set()   // "slug-a→slug-b"
  const slugSet = new Set(pages.map((p) => p.slug.toLowerCase()))

  for (const page of pages) {
    const slug = page.slug.toLowerCase()
    nodes.set(slug, {
      slug,
      title: page.title,
      wordCount: page.wordCount,
      tags: page.tags,
      outLinks: [],
      inLinks: [],
    })
  }

  for (const page of pages) {
    const from = page.slug.toLowerCase()
    for (const link of page.links) {
      // Resolve link to nearest matching slug
      const to = resolveLink(link, slugSet)
      if (!to || to === from) continue

      const edgeKey = `${from}→${to}`
      if (edges.has(edgeKey)) continue
      edges.add(edgeKey)

      nodes.get(from)?.outLinks.push(to)
      if (nodes.has(to)) nodes.get(to).inLinks.push(from)
    }
  }

  // Compute degree
  for (const node of nodes.values()) {
    node.degree = node.outLinks.length + node.inLinks.length
  }

  return { nodes, edges }
}

/**
 * Resolve a wikilink target to an existing slug using fuzzy matching.
 * Tries: exact match → basename match → partial match.
 */
function resolveLink(link, slugSet) {
  const l = link.toLowerCase()
  if (slugSet.has(l)) return l

  // Try matching just the filename part
  for (const slug of slugSet) {
    const base = slug.split('/').pop()
    if (base === l) return slug
  }

  // Try partial match (link is a suffix of slug)
  for (const slug of slugSet) {
    if (slug.endsWith('/' + l) || slug.endsWith(l)) return slug
  }

  return null  // dangling link — target page doesn't exist yet
}

/**
 * Find connected components (clusters) using BFS.
 * Returns an array of clusters, each being an array of slugs.
 */
export function findClusters(nodes) {
  const visited = new Set()
  const clusters = []

  for (const slug of nodes.keys()) {
    if (visited.has(slug)) continue

    const cluster = []
    const queue = [slug]
    while (queue.length > 0) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      cluster.push(current)

      const node = nodes.get(current)
      if (!node) continue
      for (const neighbor of [...node.outLinks, ...node.inLinks]) {
        if (!visited.has(neighbor)) queue.push(neighbor)
      }
    }
    clusters.push(cluster)
  }

  return clusters.sort((a, b) => b.length - a.length)
}

/**
 * Find orphan pages — pages with no inbound OR outbound links.
 */
export function findOrphans(nodes) {
  return [...nodes.values()]
    .filter((n) => n.degree === 0)
    .map((n) => ({ slug: n.slug, title: n.title }))
}

/**
 * Find dangling links — links that point to non-existent pages.
 * These are good candidates for new wiki pages to create.
 */
export function findDanglingLinks(pages, nodes) {
  const slugSet = new Set(nodes.keys())
  const dangling = new Map()  // target → [source pages]

  for (const page of pages) {
    for (const link of page.links) {
      const resolved = resolveLink(link, slugSet)
      if (!resolved) {
        if (!dangling.has(link)) dangling.set(link, [])
        dangling.get(link).push(page.slug)
      }
    }
  }

  return [...dangling.entries()]
    .map(([target, sources]) => ({ target, sources, count: sources.length }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Find bridge nodes — pages that connect otherwise separate clusters.
 * Removing a bridge node would split the graph.
 * High-value pages for curation.
 */
export function findBridges(nodes, clusters) {
  if (clusters.length < 2) return []

  // A simple heuristic: nodes with links to pages in different clusters
  const clusterOf = new Map()
  clusters.forEach((cluster, i) => cluster.forEach((slug) => clusterOf.set(slug, i)))

  const bridges = []
  for (const node of nodes.values()) {
    const connectedClusters = new Set()
    for (const neighbor of [...node.outLinks, ...node.inLinks]) {
      const c = clusterOf.get(neighbor)
      if (c !== undefined) connectedClusters.add(c)
    }
    if (connectedClusters.size > 1) {
      bridges.push({ slug: node.slug, title: node.title, connectsClusters: [...connectedClusters].length })
    }
  }

  return bridges.sort((a, b) => b.connectsClusters - a.connectsClusters)
}
