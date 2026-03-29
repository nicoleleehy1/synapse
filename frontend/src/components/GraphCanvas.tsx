import { useCallback, useEffect, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { forceCollide } from 'd3-force'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import type { FGData, FGNode, FGLink } from '../types/graph'
import type { DrillLevel } from '../hooks/useGraphEditor'

interface Props {
  data: FGData
  selectedNodeId: string | null
  drillStack: DrillLevel[]
  onNodeClick: (node: FGNode) => void
  onNodeDoubleClick: (node: FGNode) => void
  onDrillUp: () => void
  onCreateNode: (name: string, type: string, gx: number, gy: number) => void
  onEditNode: (nodeId: string, name: string, type: string) => void
  onDeleteNode: (nodeId: string) => void
  onCreateEdge: (sourceId: string, targetId: string, label: string) => void
  onDeleteEdge: (edgeId: string) => void
  onUpdateEdge: (edgeId: string, type: string) => void
  width: number
  height: number
}

// ── Canvas rendering constants ────────────────────────────────────────────────
const FONT_SIZE = 11
const PAD_H     = 12
const PAD_V     = 7
const RADIUS    = 7
const MAX_CHARS = 24
const CHAR_W    = 6.2

function estimateHalfWidth(name: string): number {
  const label = name.length > MAX_CHARS ? name.slice(0, MAX_CHARS - 1) + '…' : name
  return label.length * CHAR_W / 2 + PAD_H
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Shared overlay button style ───────────────────────────────────────────────
const ICON_BTN = 'w-5 h-5 flex items-center justify-center bg-foreground text-background rounded-sm hover:bg-chart-4 transition-colors'
const DANGER_BTN = 'w-5 h-5 flex items-center justify-center bg-foreground text-background rounded-sm hover:bg-red-500 transition-colors'

// ── Inline forms ──────────────────────────────────────────────────────────────

const ENTITY_TYPES = ['PERSON', 'ORGANIZATION', 'TECHNOLOGY', 'CONCEPT', 'PRODUCT', 'LOCATION', 'EVENT', 'OTHER']

function NodeForm({ initial, onConfirm, onClose }: {
  initial?: { name: string; type: string }
  onConfirm: (name: string, type: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? 'CONCEPT')
  const nameRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => { nameRef.current?.focus(); if (initial) nameRef.current?.select() }, [])

  const confirm = () => {
    if (doneRef.current) return
    doneRef.current = true
    if (name.trim()) onConfirm(name.trim(), type)
    else onClose()
  }

  return (
    <div
      className="bg-background border border-border rounded shadow-md p-2.5 min-w-[176px] space-y-2"
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        ref={nameRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') confirm()
          else if (e.key === 'Escape') { doneRef.current = true; onClose() }
        }}
        placeholder="Entity name…"
        className="text-xs w-full outline-none bg-transparent text-foreground placeholder:text-chart-2"
      />
      <select
        value={type}
        onChange={e => setType(e.target.value)}
        className="text-xs w-full outline-none bg-background text-foreground border border-border rounded px-1 py-0.5 cursor-pointer"
      >
        {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={confirm}
          className="text-2xs px-2.5 py-1 bg-foreground text-background rounded hover:opacity-80 font-medium"
        >
          {initial ? 'Save' : 'Add'}
        </button>
        <button
          onClick={() => { doneRef.current = true; onClose() }}
          className="text-2xs px-2 py-1 text-chart-2 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function EdgeLabelPopover({ initial = '', onConfirm, onClose }: {
  initial?: string
  onConfirm: (label: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => { ref.current?.focus(); if (initial) ref.current?.select() }, [])

  const confirm = () => {
    if (doneRef.current) return
    doneRef.current = true
    const label = value.trim().toUpperCase().replace(/\s+/g, '_')
    if (label) onConfirm(label)
    else { doneRef.current = false; onClose() }
  }

  return (
    <div
      className="bg-background border border-border rounded shadow-md px-2.5 py-1.5 min-w-[140px]"
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') confirm()
          else if (e.key === 'Escape') { doneRef.current = true; onClose() }
        }}
        onBlur={confirm}
        placeholder="RELATED_TO"
        className="text-xs w-full outline-none bg-transparent text-foreground font-mono placeholder:text-chart-2"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function GraphCanvas({
  data, selectedNodeId, drillStack,
  onNodeClick, onNodeDoubleClick, onDrillUp,
  onCreateNode, onEditNode, onDeleteNode,
  onCreateEdge, onDeleteEdge, onUpdateEdge,
  width, height,
}: Props) {
  const fgRef      = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Hover state
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null)
  const [hoveredLink, setHoveredLink] = useState<FGLink | null>(null)
  const hoveredNodeRef = useRef<FGNode | null>(null)
  const hoveredLinkRef = useRef<FGLink | null>(null)

  // Selected edge (click-to-reveal trash)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const selectedEdgeRef = useRef<FGLink | null>(null)

  // Hover hide timer (node → edge handle)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Screen positions for overlays (updated via rAF)
  const [edgeHandlePos, setEdgeHandlePos] = useState<{ x: number; y: number } | null>(null)
  const [actionBtnPos, setActionBtnPos]   = useState<{ x: number; y: number } | null>(null)
  const [edgeMidPos, setEdgeMidPos]       = useState<{ x: number; y: number } | null>(null)

  // Edge drag
  const edgeDragSourceRef = useRef<FGNode | null>(null)
  const [edgeDragLine, setEdgeDragLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  // Inline forms
  const [nodeCreateForm, setNodeCreateForm] = useState<{ sx: number; sy: number; gx: number; gy: number } | null>(null)
  const [nodeEditForm,   setNodeEditForm]   = useState<{ node: FGNode; sx: number; sy: number } | null>(null)
  const [edgePopover,    setEdgePopover]    = useState<{ srcId: string; tgtId: string; sx: number; sy: number } | null>(null)
  const [edgeLabelEdit,  setEdgeLabelEdit]  = useState<{ link: FGLink; sx: number; sy: number } | null>(null)

  // Double-click detection
  const lastNodeClickRef = useRef<{ id: string; time: number } | null>(null)
  const lastLinkClickRef = useRef<{ id: string; time: number } | null>(null)

  // ── Single rAF loop for all overlay positions ──────────────────────────────
  useEffect(() => {
    let rafId: number
    const tick = () => {
      const fg = fgRef.current
      if (fg) {
        const hn = hoveredNodeRef.current
        if (hn) {
          const hw = estimateHalfWidth(hn.name ?? '')
          const p = fg.graph2ScreenCoords((hn.x ?? 0) + hw + 2, hn.y ?? 0)
          setEdgeHandlePos(p)
        } else {
          setEdgeHandlePos(null)
        }

        const selNode = selectedNodeId ? data.nodes.find(n => n.id === selectedNodeId) : null
        if (selNode) {
          const nh = FONT_SIZE + PAD_V * 2
          const p = fg.graph2ScreenCoords(selNode.x ?? 0, (selNode.y ?? 0) - nh / 2 - 10)
          setActionBtnPos(p)
        } else {
          setActionBtnPos(null)
        }

        const activeLink = selectedEdgeRef.current ?? hoveredLinkRef.current
        if (activeLink) {
          const src = activeLink.source as FGNode
          const tgt = activeLink.target as FGNode
          if (src.x != null && tgt.x != null) {
            const p = fg.graph2ScreenCoords((src.x + tgt.x) / 2, ((src.y ?? 0) + (tgt.y ?? 0)) / 2)
            setEdgeMidPos(p)
          }
        } else {
          setEdgeMidPos(null)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, data.nodes])

  // ── Collision force ────────────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('collision', forceCollide((node: FGNode) => estimateHalfWidth(node.name ?? '') + 6))
    fg.d3Force('charge')?.strength(-400)
    fg.d3Force('link')?.distance(120)
    fg.d3ReheatSimulation?.()
  }, [data.nodes.length])

  // ── Edge drag document handlers ────────────────────────────────────────────
  const startEdgeDrag = useCallback((e: React.MouseEvent, node: FGNode) => {
    e.stopPropagation()
    e.preventDefault()
    edgeDragSourceRef.current = node

    const handleMove = (ev: MouseEvent) => {
      const fg = fgRef.current
      const container = containerRef.current
      if (!fg || !container || !edgeDragSourceRef.current) return
      const rect = container.getBoundingClientRect()
      const src = edgeDragSourceRef.current
      const sp = fg.graph2ScreenCoords(src.x ?? 0, src.y ?? 0)
      setEdgeDragLine({ x1: sp.x, y1: sp.y, x2: ev.clientX - rect.left, y2: ev.clientY - rect.top })
    }

    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      const src = edgeDragSourceRef.current
      edgeDragSourceRef.current = null
      setEdgeDragLine(null)
      if (!src) return

      const container = containerRef.current
      const fg = fgRef.current
      if (!container || !fg) return
      const rect = container.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top

      const target = data.nodes.find(n => {
        if (n.id === src.id) return false
        const p = fg.graph2ScreenCoords(n.x ?? 0, n.y ?? 0)
        const hw = estimateHalfWidth(n.name ?? '')
        const nh = FONT_SIZE + PAD_V * 2
        return cx >= p.x - hw && cx <= p.x + hw && cy >= p.y - nh / 2 && cy <= p.y + nh / 2
      })

      if (target) {
        setEdgePopover({ srcId: src.id, tgtId: target.id, sx: cx, sy: cy })
      }
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [data.nodes])

  // ── Node hover ─────────────────────────────────────────────────────────────
  const handleNodeHover = useCallback((rawNode: any) => {
    clearTimeout(hideTimerRef.current)
    const node = rawNode as FGNode | null
    hoveredNodeRef.current = node
    if (node) {
      setHoveredNode(node)
    } else {
      hideTimerRef.current = setTimeout(() => {
        hoveredNodeRef.current = null
        setHoveredNode(null)
      }, 180)
    }
  }, [])

  // ── Link hover ─────────────────────────────────────────────────────────────
  const handleLinkHover = useCallback((rawLink: any) => {
    const link = rawLink as FGLink | null
    hoveredLinkRef.current = link
    setHoveredLink(link)
  }, [])

  // ── Node click (with double-click detection) ───────────────────────────────
  const handleNodeClick = useCallback((rawNode: any) => {
    const node = rawNode as FGNode
    const now  = Date.now()
    const last = lastNodeClickRef.current
    if (last && last.id === node.id && now - last.time < 350) {
      lastNodeClickRef.current = null
      onNodeDoubleClick(node)
      return
    }
    lastNodeClickRef.current = { id: node.id, time: now }
    setSelectedEdgeId(null)
    selectedEdgeRef.current = null
    onNodeClick(node)
  }, [onNodeClick, onNodeDoubleClick])

  // ── Link click (with double-click detection) ───────────────────────────────
  const handleLinkClick = useCallback((rawLink: any) => {
    const link = rawLink as FGLink
    const now  = Date.now()
    const last = lastLinkClickRef.current
    if (last && last.id === link.id && now - last.time < 350) {
      lastLinkClickRef.current = null
      if (edgeMidPos) setEdgeLabelEdit({ link, sx: edgeMidPos.x, sy: edgeMidPos.y })
      return
    }
    lastLinkClickRef.current = { id: link.id, time: now }
    const isAlreadySelected = selectedEdgeId === link.id
    setSelectedEdgeId(isAlreadySelected ? null : link.id)
    selectedEdgeRef.current = isAlreadySelected ? null : link
  }, [selectedEdgeId, edgeMidPos])

  // ── Background click ───────────────────────────────────────────────────────
  const handleBackgroundClick = useCallback((event: MouseEvent) => {
    // Clear edge selection
    setSelectedEdgeId(null)
    selectedEdgeRef.current = null

    const container = containerRef.current
    const fg = fgRef.current
    if (!container || !fg) return
    const rect = container.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top

    // If a node was selected, deselect on first click (don't open form)
    if (selectedNodeId) {
      const selNode = data.nodes.find(n => n.id === selectedNodeId)
      if (selNode) onNodeClick(selNode)  // toggle-deselects in App
      return
    }

    const gp = fg.screen2GraphCoords(sx, sy)
    setNodeCreateForm({ sx, sy, gx: gp.x, gy: gp.y })
  }, [selectedNodeId, data.nodes, onNodeClick])

  // ── Canvas renderers ───────────────────────────────────────────────────────
  const nodeCanvasObject = useCallback((node: FGNode, ctx: CanvasRenderingContext2D) => {
    const isSelected = node.id === selectedNodeId
    const label = node.name.length > MAX_CHARS ? node.name.slice(0, MAX_CHARS - 1) + '…' : node.name
    ctx.font = `500 ${FONT_SIZE}px Inter, system-ui, sans-serif`
    const textW = ctx.measureText(label).width
    const nodeW = textW + PAD_H * 2
    const nodeH = FONT_SIZE + PAD_V * 2
    const x = (node.x ?? 0) - nodeW / 2
    const y = (node.y ?? 0) - nodeH / 2

    if (isSelected) {
      drawRoundedRect(ctx, x - 2.5, y - 2.5, nodeW + 5, nodeH + 5, RADIUS + 2)
      ctx.strokeStyle = '#0a0a0a'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    drawRoundedRect(ctx, x, y, nodeW, nodeH, RADIUS)
    ctx.fillStyle = node.color ?? '#d4d4d4'
    ctx.fill()
    ctx.fillStyle = node.textColor ?? '#0a0a0a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, node.x ?? 0, node.y ?? 0)
  }, [selectedNodeId])

  const nodePointerAreaPaint = useCallback((node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.font = `500 ${FONT_SIZE}px Inter, system-ui, sans-serif`
    const label = node.name.length > MAX_CHARS ? node.name.slice(0, MAX_CHARS - 1) + '…' : node.name
    const textW = ctx.measureText(label).width
    const nodeW = textW + PAD_H * 2
    const nodeH = FONT_SIZE + PAD_V * 2
    ctx.fillStyle = color
    ctx.fillRect((node.x ?? 0) - nodeW / 2, (node.y ?? 0) - nodeH / 2, nodeW, nodeH)
  }, [])

  const linkCanvasObject = useCallback((link: FGLink, ctx: CanvasRenderingContext2D) => {
    const src = link.source as FGNode
    const tgt = link.target as FGNode
    if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) return
    const isActive = hoveredLink?.id === link.id || selectedEdgeId === link.id
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(tgt.x, tgt.y)
    ctx.strokeStyle = isActive ? 'rgba(0,0,0,0.4)' : (link.color ?? 'rgba(0,0,0,0.08)')
    ctx.lineWidth = isActive ? 1.5 : 0.75
    ctx.stroke()
  }, [hoveredLink, selectedEdgeId])

  const selectedNode = selectedNodeId ? data.nodes.find(n => n.id === selectedNodeId) : null

  return (
    <div ref={containerRef} style={{ width, height, position: 'relative' }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={data as never}
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        width={width}
        height={height}
        backgroundColor="#ffffff"
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={nodePointerAreaPaint as never}
        linkCanvasObject={linkCanvasObject as never}
        linkCanvasObjectMode={() => 'replace'}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        onLinkHover={handleLinkHover}
        onBackgroundClick={handleBackgroundClick as never}
        linkHoverPrecision={8}
        nodeLabel=""
        linkLabel=""
        cooldownTicks={150}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
      />

      {/* SVG overlay — edge drag temp line */}
      {edgeDragLine && (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <line
            x1={edgeDragLine.x1} y1={edgeDragLine.y1}
            x2={edgeDragLine.x2} y2={edgeDragLine.y2}
            stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} strokeDasharray="5,4"
          />
        </svg>
      )}

      {/* Edge handle "+" on hovered node border */}
      {edgeHandlePos && hoveredNode && !edgeDragLine && (
        <button
          style={{ position: 'absolute', left: edgeHandlePos.x - 10, top: edgeHandlePos.y - 10, zIndex: 20 }}
          className={ICON_BTN}
          onMouseEnter={() => clearTimeout(hideTimerRef.current)}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => { hoveredNodeRef.current = null; setHoveredNode(null) }, 180) }}
          onMouseDown={(e) => startEdgeDrag(e, hoveredNode)}
          title={`Drag to connect from ${hoveredNode.name}`}
        >
          <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 300 }}>+</span>
        </button>
      )}

      {/* Floating action buttons (pencil + trash) above selected node */}
      {actionBtnPos && selectedNode && !nodeCreateForm && !nodeEditForm && (
        <div
          style={{
            position: 'absolute',
            left: actionBtnPos.x,
            top: actionBtnPos.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
          className="flex gap-1"
        >
          <button
            className={ICON_BTN}
            title="Edit entity"
            onClick={() => {
              if (!actionBtnPos) return
              setNodeEditForm({ node: selectedNode, sx: actionBtnPos.x, sy: actionBtnPos.y })
            }}
          >
            <Pencil size={10} />
          </button>
          <button
            className={DANGER_BTN}
            title="Delete entity"
            onClick={() => onDeleteNode(selectedNode.id)}
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}

      {/* Edge midpoint trash — shown when edge is selected or hovered */}
      {edgeMidPos && (hoveredLink || selectedEdgeId) && !edgeLabelEdit && (
        <button
          style={{ position: 'absolute', left: edgeMidPos.x - 10, top: edgeMidPos.y - 10, zIndex: 20 }}
          className={DANGER_BTN}
          title="Delete relationship"
          onClick={() => {
            const id = selectedEdgeId ?? hoveredLink?.id
            if (id) { onDeleteEdge(id); setSelectedEdgeId(null); selectedEdgeRef.current = null }
          }}
        >
          <Trash2 size={10} />
        </button>
      )}

      {/* Inline node creation form */}
      {nodeCreateForm && (
        <div
          style={{
            position: 'absolute',
            left: nodeCreateForm.sx,
            top: nodeCreateForm.sy,
            transform: 'translate(-50%, -50%)',
            zIndex: 50,
          }}
        >
          <NodeForm
            onConfirm={(name, type) => {
              onCreateNode(name, type, nodeCreateForm.gx, nodeCreateForm.gy)
              setNodeCreateForm(null)
            }}
            onClose={() => setNodeCreateForm(null)}
          />
        </div>
      )}

      {/* Inline node edit form */}
      {nodeEditForm && (
        <div
          style={{
            position: 'absolute',
            left: nodeEditForm.sx,
            top: nodeEditForm.sy,
            transform: 'translate(-50%, -120%)',
            zIndex: 50,
          }}
        >
          <NodeForm
            initial={{ name: nodeEditForm.node.name, type: nodeEditForm.node.type }}
            onConfirm={(name, type) => {
              onEditNode(nodeEditForm.node.id, name, type)
              setNodeEditForm(null)
            }}
            onClose={() => setNodeEditForm(null)}
          />
        </div>
      )}

      {/* Edge label popover (after drag-to-connect) */}
      {edgePopover && (
        <div
          style={{
            position: 'absolute',
            left: edgePopover.sx,
            top: edgePopover.sy,
            transform: 'translate(-50%, -120%)',
            zIndex: 50,
          }}
        >
          <EdgeLabelPopover
            onConfirm={(label) => {
              onCreateEdge(edgePopover.srcId, edgePopover.tgtId, label)
              setEdgePopover(null)
            }}
            onClose={() => setEdgePopover(null)}
          />
        </div>
      )}

      {/* Edge label edit form (double-click on edge) */}
      {edgeLabelEdit && (
        <div
          style={{
            position: 'absolute',
            left: edgeLabelEdit.sx,
            top: edgeLabelEdit.sy,
            transform: 'translate(-50%, -120%)',
            zIndex: 50,
          }}
        >
          <EdgeLabelPopover
            initial={edgeLabelEdit.link.type}
            onConfirm={(label) => {
              onUpdateEdge(edgeLabelEdit.link.id, label)
              setEdgeLabelEdit(null)
            }}
            onClose={() => setEdgeLabelEdit(null)}
          />
        </div>
      )}

      {/* Breadcrumb — drill-down navigation */}
      {drillStack.length > 0 && (
        <div className="absolute top-4 left-4 z-30">
          <button
            onClick={onDrillUp}
            className="flex items-center gap-1 text-xs text-chart-3 border border-border rounded px-2.5 py-1.5 bg-background hover:border-chart-3 hover:text-foreground transition-colors"
          >
            <ChevronLeft size={12} />
            {drillStack[drillStack.length - 1].focalNodeName}
          </button>
        </div>
      )}

      {/* Edge tooltip */}
      {hoveredLink && !edgeLabelEdit && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: (edgeMidPos?.x ?? 0) + 14, top: (edgeMidPos?.y ?? 0) - 32 }}
        >
          <div className="bg-foreground text-background text-xs font-medium px-2.5 py-1.5 rounded whitespace-nowrap">
            <span className="font-mono">{hoveredLink.type}</span>
            {hoveredLink.description && (
              <span className="text-chart-1 font-normal ml-1.5 max-w-[200px] truncate inline-block align-bottom">
                — {hoveredLink.description}
              </span>
            )}
            <span className="text-chart-2 ml-2">{(hoveredLink.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
