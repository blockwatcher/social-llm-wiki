import { analyzeWiki } from '@social-llm-wiki/graph'

/**
 * wiki_gaps — Gap analysis and research question generation
 *
 * Identifies unconnected clusters in the knowledge graph and generates
 * targeted prompts to explore the gaps — the core InfraNodus approach.
 * Use this to find non-obvious connections and generate original insights.
 */
export async function wikiGaps({ wikiRoot, namespace = '' }) {
  const result = await analyzeWiki(wikiRoot, namespace)

  if (result.empty) {
    return { content: [{ type: 'text', text: `No pages found in namespace: "${namespace}"` }] }
  }

  const { gapReport } = result

  if (gapReport.gaps.length === 0 && gapReport.lintIssues.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `## Gap Analysis — ${namespace || 'all'}\n\nNo significant gaps found. The wiki is well-connected!\n` +
          `(${result.pages} pages, ${result.edges} links, ${result.clusters.length} cluster(s))`,
      }],
    }
  }

  const lines = [
    `## Gap Analysis — ${namespace || 'all namespaces'}`,
    `_${result.pages} pages · ${result.edges} links · ${gapReport.gaps.length} gap(s) found_`,
    '',
  ]

  if (gapReport.gaps.length > 0) {
    lines.push('### Knowledge Gaps')
    lines.push('_These clusters are not connected — each gap is an opportunity for a new insight or page._')
    lines.push('')

    for (let i = 0; i < gapReport.gaps.length; i++) {
      const gap = gapReport.gaps[i]
      lines.push(`#### Gap ${i + 1}: "${gap.clusterA.topics[0]}" ↔ "${gap.clusterB.topics[0]}"`)
      lines.push(`- Cluster A topics: ${gap.clusterA.topics.join(', ')} (${gap.clusterA.size} pages)`)
      lines.push(`- Cluster B topics: ${gap.clusterB.topics.join(', ')} (${gap.clusterB.size} pages)`)
      lines.push('')
      lines.push(`**Research prompt:**`)
      lines.push(`> ${gap.prompt}`)
      lines.push('')
    }
  }

  if (gapReport.suggestions.length > 0) {
    lines.push('### Suggested Actions')
    for (const s of gapReport.suggestions) {
      lines.push(`- **[${s.priority}]** ${s.description}`)
      if (s.pages) lines.push(`  Pages: ${s.pages.join(', ')}`)
    }
    lines.push('')
  }

  if (gapReport.lintIssues.length > 0) {
    lines.push('### Lint Issues')
    for (const issue of gapReport.lintIssues) {
      lines.push(`- **[${issue.severity}]** ${issue.message}`)
      if (issue.examples?.length) {
        lines.push(`  Examples: ${issue.examples.join(', ')}`)
      }
    }
    lines.push('')
  }

  if (gapReport.dangling.length > 0) {
    lines.push('### Missing pages (referenced but not created yet)')
    for (const d of gapReport.dangling) {
      lines.push(`- \`${d.target}\` — linked from ${d.count} page(s)`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
