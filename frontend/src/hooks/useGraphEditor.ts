import { useCallback, useEffect, useRef, useState } from 'react'
import type { FGData, FGNode, FGLink } from '../types/graph'

const ENTITY_STYLE: Record<string, { bg: string; text: string }> = {
  PERSON:       { bg: '#1a1a1a', text: '#ffffff' },
  ORGANIZATION: { bg: '#404040', text: '#ffffff' },
  TECHNOLOGY:   { bg: '#525252', text: '#ffffff' },
  EVENT:        { bg: '#525252', text: '#ffffff' },
  LOCATION:     { bg: '#404040', text: '#ffffff' },
  CONCEPT:      { bg: '#a3a3a3', text: '#0a0a0a' },
  PRODUCT:      { bg: '#a3a3a3', text: '#0a0a0a' },
  OTHER:        { bg: '#d4d4d4', text: '#0a0a0a' },
}

export interface DrillLevel {
  graph: FGData
  focalNodeName: string
}

// Undo entries — full snapshot for add/remove, patch for in-place updates
type UndoEntry =
  | { tag: 'snap'; graph: FGData }
  | { tag: 'nodeUpdate'; nodeId: string; prev: Partial<FGNode> }
  | { tag: 'linkUpdate'; linkId: string; prev: string }

function parseBullets(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map(s => s.replace(/^[\d\-*•]+\.?\s*/, '').trim())
    .filter(s => s.length > 4)
    .slice(0, 8)
}

function styledNode(partial: Omit<FGNode, 'color' | 'textColor' | 'val'>): FGNode {
  const style = ENTITY_STYLE[partial.type] ?? ENTITY_STYLE.OTHER
  return { ...partial, color: style.bg, textColor: style.text, val: Math.max(4, partial.name.length) }
}

export function useGraphEditor(externalGraph: FGData) {
  const graphRef = useRef<FGData>(externalGraph)
  const [graph, _setGraph] = useState<FGData>(externalGraph)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([])

  // Sync when externalGraph changes (API load) — only at root level
  useEffect(() => {
    if (drillStack.length === 0) {
      graphRef.current = externalGraph
      _setGraph(externalGraph)
      setUndoStack([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalGraph])

  const overlayData = useCallback((incoming: FGData) => {
    const prev = graphRef.current
    const nodeIds = new Set(prev.nodes.map(n => n.id))
    const linkIds = new Set(prev.links.map(l => l.id))
    const merged: FGData = {
      nodes: [...prev.nodes, ...incoming.nodes.filter(n => !nodeIds.has(n.id))],
      links: [...prev.links, ...incoming.links.filter(l => !linkIds.has(l.id))],
    }
    graphRef.current = merged
    _setGraph(merged)
  }, [])

  // ── Mutations with correct undo snapshotting ──────────────────────────────

  const addNode = useCallback((node: FGNode) => {
    const before = graphRef.current          // capture BEFORE mutation
    const g: FGData = { ...before, nodes: [...before.nodes, node] }
    graphRef.current = g
    _setGraph(g)
    setUndoStack(prev => [...prev.slice(-49), { tag: 'snap', graph: before }])
  }, [])

  const addLink = useCallback((link: FGLink) => {
    const before = graphRef.current
    const g: FGData = { ...before, links: [...before.links, link] }
    graphRef.current = g
    _setGraph(g)
    setUndoStack(prev => [...prev.slice(-49), { tag: 'snap', graph: before }])
  }, [])

  /**
   * Update a node's display properties (name, type, description) IN PLACE.
   * This preserves the exact node object that d3-force holds, so the simulation
   * position and all edge references stay intact.
   */
  const updateNode = useCallback((
    nodeId: string,
    updates: { name?: string; type?: string; description?: string },
  ) => {
    const existing = graphRef.current.nodes.find(n => n.id === nodeId)
    if (!existing) return

    // Save old values for undo BEFORE mutation
    const prev: Partial<FGNode> = {
      name: existing.name,
      type: existing.type,
      description: existing.description,
      color: existing.color,
      textColor: existing.textColor,
      val: existing.val,
    }

    // Mutate the existing object in place — d3-force keeps its reference
    const newName = updates.name ?? existing.name
    const newType = (updates.type ?? existing.type).toUpperCase()
    const style = ENTITY_STYLE[newType] ?? ENTITY_STYLE.OTHER
    Object.assign(existing, {
      name: newName,
      type: newType,
      description: updates.description !== undefined ? updates.description : existing.description,
      color: style.bg,
      textColor: style.text,
      val: Math.max(4, newName.length),
    })

    // New array reference triggers React re-render without replacing node objects
    _setGraph({ ...graphRef.current, nodes: [...graphRef.current.nodes] })
    setUndoStack(u => [...u.slice(-49), { tag: 'nodeUpdate', nodeId, prev }])
  }, [])

  /**
   * Update an edge's type IN PLACE. Preserves d3-force link references.
   */
  const updateLink = useCallback((linkId: string, type: string) => {
    const existing = graphRef.current.links.find(l => l.id === linkId)
    if (!existing) return
    const prevType = existing.type
    existing.type = type.trim().toUpperCase().replace(/\s+/g, '_') || 'RELATED_TO'
    _setGraph({ ...graphRef.current, links: [...graphRef.current.links] })
    setUndoStack(u => [...u.slice(-49), { tag: 'linkUpdate', linkId, prev: prevType }])
  }, [])

  const removeNode = useCallback((nodeId: string) => {
    const before = graphRef.current
    const g: FGData = {
      nodes: before.nodes.filter(n => n.id !== nodeId),
      links: before.links.filter(l => {
        const s = typeof l.source === 'object' ? (l.source as FGNode).id : l.source
        const t = typeof l.target === 'object' ? (l.target as FGNode).id : l.target
        return s !== nodeId && t !== nodeId
      }),
    }
    graphRef.current = g
    _setGraph(g)
    setUndoStack(prev => [...prev.slice(-49), { tag: 'snap', graph: before }])
  }, [])

  const removeLink = useCallback((linkId: string) => {
    const before = graphRef.current
    const g: FGData = { ...before, links: before.links.filter(l => l.id !== linkId) }
    graphRef.current = g
    _setGraph(g)
    setUndoStack(prev => [...prev.slice(-49), { tag: 'snap', graph: before }])
  }, [])

  // ── Drill-down ─────────────────────────────────────────────────────────────

  const drillDown = useCallback((node: FGNode): boolean => {
    const bullets = parseBullets(node.description ?? '')
    if (bullets.length === 0) return false

    setDrillStack(prev => [...prev, { graph: graphRef.current, focalNodeName: node.name }])
    setUndoStack([])

    const hub = styledNode({ ...node, fx: 0, fy: 0, x: 0, y: 0 })
    const childNodes: FGNode[] = bullets.map((text, i) => {
      const angle = (2 * Math.PI * i) / bullets.length - Math.PI / 2
      const r = 200
      const cx = r * Math.cos(angle)
      const cy = r * Math.sin(angle)
      const name = text.length > 55 ? text.slice(0, 54) + '…' : text
      return styledNode({
        id: `drill-${node.id}-${i}`,
        name,
        type: 'CONCEPT',
        description: text,
        source_document: node.source_document,
        chunk_count: 0,
        fx: cx, fy: cy, x: cx, y: cy,
      })
    })
    const links: FGLink[] = childNodes.map((child, i) => ({
      id: `drill-link-${node.id}-${i}`,
      source: hub.id,
      target: child.id,
      type: 'DESCRIBES',
      confidence: 1.0,
      source_document: node.source_document,
      color: 'rgba(0,0,0,0.12)',
    }))

    const g = { nodes: [hub, ...childNodes], links }
    graphRef.current = g
    _setGraph(g)
    return true
  }, [])

  const drillUp = useCallback(() => {
    setDrillStack(prev => {
      if (prev.length === 0) return prev
      const top = prev[prev.length - 1]
      graphRef.current = top.graph
      _setGraph(top.graph)
      setUndoStack([])
      return prev.slice(0, -1)
    })
  }, [])

  // ── Undo ───────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (drillStack.length > 0) {
      drillUp()
      return
    }
    setUndoStack(prev => {
      if (prev.length === 0) return prev
      const top = prev[prev.length - 1]

      if (top.tag === 'snap') {
        graphRef.current = top.graph
        _setGraph(top.graph)
      } else if (top.tag === 'nodeUpdate') {
        const node = graphRef.current.nodes.find(n => n.id === top.nodeId)
        if (node) {
          Object.assign(node, top.prev)
          _setGraph({ ...graphRef.current, nodes: [...graphRef.current.nodes] })
        }
      } else if (top.tag === 'linkUpdate') {
        const link = graphRef.current.links.find(l => l.id === top.linkId)
        if (link) {
          link.type = top.prev
          _setGraph({ ...graphRef.current, links: [...graphRef.current.links] })
        }
      }

      return prev.slice(0, -1)
    })
  }, [drillStack.length, drillUp])

  return {
    graph,
    drillStack,
    undoStack,
    canUndo: undoStack.length > 0 || drillStack.length > 0,
    overlayData,
    addNode,
    addLink,
    updateNode,
    updateLink,
    removeNode,
    removeLink,
    drillDown,
    drillUp,
    undo,
  }
}
