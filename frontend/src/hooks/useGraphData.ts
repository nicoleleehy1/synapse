import { useCallback, useState } from 'react'
import { getFullGraph, getEntityNeighbourhood } from '../api/client'
import type { FGData, FGNode, FGLink, GraphData } from '../types/graph'

// chart-1 through chart-5 — light needs dark text, dark needs white text
const ENTITY_STYLE: Record<string, { bg: string; text: string }> = {
  PERSON:       { bg: '#1a1a1a', text: '#ffffff' },  // chart-5
  ORGANIZATION: { bg: '#404040', text: '#ffffff' },  // chart-4
  TECHNOLOGY:   { bg: '#525252', text: '#ffffff' },  // chart-3
  EVENT:        { bg: '#525252', text: '#ffffff' },  // chart-3
  LOCATION:     { bg: '#404040', text: '#ffffff' },  // chart-4
  CONCEPT:      { bg: '#a3a3a3', text: '#0a0a0a' },  // chart-2
  PRODUCT:      { bg: '#a3a3a3', text: '#0a0a0a' },  // chart-2
  OTHER:        { bg: '#d4d4d4', text: '#0a0a0a' },  // chart-1
}

export function toFGData(data: GraphData): FGData {
  const nodes: FGNode[] = data.nodes.map((n) => {
    const style = ENTITY_STYLE[n.type] ?? ENTITY_STYLE.OTHER
    return {
      ...n,
      color: style.bg,
      textColor: style.text,
      val: Math.max(4, n.name.length),
    }
  })
  const links: FGLink[] = data.edges.map((e) => ({
    ...e,
    color: `rgba(0,0,0,${Math.max(0.06, e.confidence * 0.15)})`,
  }))
  return { nodes, links }
}

export function useGraphData() {
  const [graphData, setGraphData] = useState<FGData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<FGNode | null>(null)

  const loadFullGraph = useCallback(async (documentId?: string) => {
    setLoading(true)
    try {
      const data = await getFullGraph(documentId)
      setGraphData(toFGData(data))
    } finally {
      setLoading(false)
    }
  }, [])

  const expandNode = useCallback(async (node: FGNode) => {
    setLoading(true)
    try {
      const data = await getEntityNeighbourhood(node.id, 2)
      const fg = toFGData(data)
      setGraphData((prev) => {
        const existingNodeIds = new Set(prev.nodes.map((n) => n.id))
        const existingLinkIds = new Set(prev.links.map((l) => l.id))
        return {
          nodes: [...prev.nodes, ...fg.nodes.filter((n) => !existingNodeIds.has(n.id))],
          links: [...prev.links, ...fg.links.filter((l) => !existingLinkIds.has(l.id))],
        }
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const overlayGraph = useCallback((data: GraphData) => {
    const fg = toFGData(data)
    setGraphData((prev) => {
      const existingNodeIds = new Set(prev.nodes.map((n) => n.id))
      const existingLinkIds = new Set(prev.links.map((l) => l.id))
      return {
        nodes: [...prev.nodes, ...fg.nodes.filter((n) => !existingNodeIds.has(n.id))],
        links: [...prev.links, ...fg.links.filter((l) => !existingLinkIds.has(l.id))],
      }
    })
  }, [])

  const loadSample = useCallback((sample: FGData) => {
    setGraphData(sample)
  }, [])

  return {
    graphData,
    loading,
    selectedNode,
    setSelectedNode,
    loadFullGraph,
    expandNode,
    overlayGraph,
    loadSample,
    resetGraph: () => setGraphData({ nodes: [], links: [] }),
  }
}
