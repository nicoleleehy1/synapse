import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { FileUpload } from './components/FileUpload'
import { GraphCanvas } from './components/GraphCanvas'
import { NodeInspector } from './components/NodeInspector'
import { QueryPanel } from './components/QueryPanel'
import { Legend } from './components/Legend'
import { AddNodeModal, AddEdgeModal } from './components/AddNodeModal'
import { DeleteNodeModal, DeleteEdgeModal } from './components/DeleteConfirmModal'
import { useDocumentUpload } from './hooks/useDocumentUpload'
import { useGraphData, toFGData } from './hooks/useGraphData'
import { useGraphEditor } from './hooks/useGraphEditor'
import {
  deleteDocument,
  createNode, createEdge, updateNode as apiUpdateNode,
  deleteNode, deleteEdge,
  getNodeOrphans, getEdgeOrphanTarget, getEntityNeighbourhood,
} from './api/client'
import type { DocumentStatus, FGNode, FGLink, GraphNode } from './types/graph'
import { SAMPLE_GRAPH } from './data/sampleGraph'

// ── Modal state types ──────────────────────────────────────────────────────────
type AddNodeState = { parentNode: FGNode }
type AddEdgeState = { sourceNode: FGNode }
type DelNodeState = { node: FGNode; orphans: GraphNode[] }
type DelEdgeState = { edge: FGLink; orphanTarget: GraphNode | null; sourceName: string; targetName: string }

// ── Entity style for new nodes ─────────────────────────────────────────────────
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

export default function App() {
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const [documents, setDocuments] = useState<DocumentStatus[]>([])
  const [selectedNode, setSelectedNode] = useState<FGNode | null>(null)

  // Modal state — kept for NodeInspector sidebar actions
  const [addNodeModal,  setAddNodeModal]  = useState<AddNodeState | null>(null)
  const [addEdgeModal,  setAddEdgeModal]  = useState<AddEdgeState | null>(null)
  const [delNodeModal,  setDelNodeModal]  = useState<DelNodeState | null>(null)
  const [delEdgeModal,  setDelEdgeModal]  = useState<DelEdgeState | null>(null)

  const { upload, uploading, status, error } = useDocumentUpload()
  const { graphData, loading: graphLoading, loadFullGraph, loadSample, resetGraph } = useGraphData()
  const editor = useGraphEditor(graphData)

  // Canvas resize
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setCanvasSize({ width, height })
    })
    if (canvasContainerRef.current) obs.observe(canvasContainerRef.current)
    return () => obs.disconnect()
  }, [])

  // Document lifecycle
  useEffect(() => {
    if (!status) return
    if (status.status === 'complete' || status.status === 'error') {
      setDocuments((prev) => [...prev.filter(d => d.document_id !== status.document_id), status])
      if (status.status === 'complete') loadFullGraph()
    }
  }, [status?.status, status?.document_id, loadFullGraph])

  // Cmd+Z / Ctrl+Z undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        editor.undo()
        setSelectedNode(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editor.undo])

  // ── Document delete ────────────────────────────────────────────────────────
  const handleDeleteDocument = async (doc: DocumentStatus) => {
    try { await deleteDocument(doc.document_id) } catch { /* ignore */ }
    setDocuments(prev => prev.filter(d => d.document_id !== doc.document_id))
    loadFullGraph()
  }

  // ── Canvas: create node at position ───────────────────────────────────────
  const handleCanvasCreateNode = useCallback(async (name: string, type: string, gx: number, gy: number) => {
    const style = ENTITY_STYLE[type] ?? ENTITY_STYLE.OTHER
    const tempId = crypto.randomUUID()
    const newNode: FGNode = {
      id: tempId, name, type,
      source_document: 'Manual', chunk_count: 0,
      color: style.bg, textColor: style.text, val: Math.max(4, name.length),
      x: gx, y: gy,
    }
    editor.addNode(newNode)

    // Persist to backend (silently; replace temp node with real ID on success)
    try {
      const result = await createNode({ name, type })
      const fgResult = toFGData(result)
      const realNode = fgResult.nodes[0]
      if (realNode && realNode.id !== tempId) {
        editor.removeNode(tempId)
        // Preserve click position so the node doesn't jump to a random location
        realNode.x = gx
        realNode.y = gy
        editor.addNode(realNode)
      }
    } catch { /* sample graph or offline — local node is fine */ }
  }, [editor])

  // ── Canvas: edit node inline ───────────────────────────────────────────────
  const handleCanvasEditNode = useCallback(async (nodeId: string, name: string, type: string) => {
    editor.updateNode(nodeId, { name, type })
    try { await apiUpdateNode(nodeId, { name, type }) } catch { /* ignore */ }
  }, [editor])

  // ── Canvas: delete node (immediate, cascade) ───────────────────────────────
  const handleCanvasDeleteNode = useCallback(async (nodeId: string) => {
    editor.removeNode(nodeId)
    setSelectedNode(null)
    try { await deleteNode(nodeId, true) } catch { /* ignore */ }
  }, [editor])

  // ── Canvas: create edge (drag-to-connect) ─────────────────────────────────
  const handleCanvasCreateEdge = useCallback(async (sourceId: string, targetId: string, label: string) => {
    const id = crypto.randomUUID()
    const newLink: FGLink = {
      id, source: sourceId, target: targetId, type: label,
      confidence: 1.0, source_document: 'Manual',
      color: 'rgba(0,0,0,0.10)',
    }
    editor.addLink(newLink)
    try {
      const result = await createEdge({ source_entity_id: sourceId, target_entity_id: targetId, type: label, confidence: 1.0 })
      // Replace temp edge with real ID
      editor.removeLink(id)
      editor.addLink({ ...newLink, id: result.id })
    } catch { /* ignore */ }
  }, [editor])

  // ── Canvas: delete edge ────────────────────────────────────────────────────
  const handleCanvasDeleteEdge = useCallback(async (edgeId: string) => {
    editor.removeLink(edgeId)
    try { await deleteEdge(edgeId, false) } catch { /* ignore */ }
  }, [editor])

  // ── Canvas: update edge label ──────────────────────────────────────────────
  const handleCanvasUpdateEdge = useCallback(async (edgeId: string, type: string) => {
    editor.updateLink(edgeId, type)
    // No backend update endpoint for edges yet; local-only
  }, [editor])

  // ── NodeInspector: expand neighbourhood ───────────────────────────────────
  const handleExpandNode = useCallback(async (node: FGNode) => {
    try {
      const data = await getEntityNeighbourhood(node.id, 2)
      editor.overlayData(toFGData(data))
    } catch { /* ignore */ }
  }, [editor])

  // ── NodeInspector: add node (modal flow) ──────────────────────────────────
  const handleAddNodeRequest = (parentNode: FGNode) => setAddNodeModal({ parentNode })
  const handleAddNodeConfirm = async (payload: Parameters<typeof createNode>[0]) => {
    const result = await createNode(payload)
    editor.overlayData(toFGData(result))
    setAddNodeModal(null)
  }

  // ── NodeInspector: add edge (modal flow) ──────────────────────────────────
  const handleAddEdgeRequest = (sourceNode: FGNode) => setAddEdgeModal({ sourceNode })
  const handleAddEdgeConfirm = async (payload: Parameters<typeof createEdge>[0]) => {
    await createEdge(payload)
    await loadFullGraph()
    setAddEdgeModal(null)
  }

  // ── NodeInspector: delete node (modal with orphan check) ──────────────────
  const handleDeleteNodeRequest = async (node: FGNode) => {
    const { orphaned_nodes } = await getNodeOrphans(node.id)
    setDelNodeModal({ node, orphans: orphaned_nodes })
  }
  const handleDeleteNodeOnly = async () => {
    if (!delNodeModal) return
    await deleteNode(delNodeModal.node.id, false)
    editor.removeNode(delNodeModal.node.id)
    setDelNodeModal(null)
    setSelectedNode(null)
  }
  const handleDeleteNodeCascade = async () => {
    if (!delNodeModal) return
    await deleteNode(delNodeModal.node.id, true)
    loadFullGraph()
    setDelNodeModal(null)
    setSelectedNode(null)
  }

  // ── NodeInspector: delete edge (modal with orphan check) ──────────────────
  const handleDeleteEdgeRequest = async (edge: FGLink) => {
    const { orphaned_target } = await getEdgeOrphanTarget(edge.id)
    const nodeMap = new Map(editor.graph.nodes.map(n => [n.id, n]))
    const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source
    const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target
    setDelEdgeModal({
      edge, orphanTarget: orphaned_target,
      sourceName: nodeMap.get(srcId)?.name ?? srcId,
      targetName: nodeMap.get(tgtId)?.name ?? tgtId,
    })
  }
  const handleDeleteEdgeOnly = async () => {
    if (!delEdgeModal) return
    await deleteEdge(delEdgeModal.edge.id, false)
    editor.removeLink(delEdgeModal.edge.id)
    setDelEdgeModal(null)
  }
  const handleDeleteEdgeCascade = async () => {
    if (!delEdgeModal) return
    await deleteEdge(delEdgeModal.edge.id, true)
    loadFullGraph()
    setDelEdgeModal(null)
    if (delEdgeModal.orphanTarget?.id === selectedNode?.id) setSelectedNode(null)
  }

  // ── Overlay from semantic search ───────────────────────────────────────────
  const handleOverlayGraph = useCallback((rawData: Parameters<typeof toFGData>[0]) => {
    editor.overlayData(toFGData(rawData))
  }, [editor])

  const nodeMap = new Map<string, FGNode>(editor.graph.nodes.map(n => [n.id, n]))
  const completedDocs = documents.filter(d => d.status === 'complete')

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-[320px] shrink-0 flex flex-col border-r border-border overflow-y-auto">
        <div className="px-7 pt-8 pb-6 border-b border-border">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Knowledge Graph</h1>
          <p className="text-xs text-chart-2 mt-1">PDF → entity graph · semantic search</p>
        </div>

        <div className="flex-1 px-7 py-6 space-y-8">

          <section>
            <SectionLabel>Document</SectionLabel>
            <FileUpload onUpload={upload} uploading={uploading} status={status} error={error} />
          </section>

          {completedDocs.length > 0 && (
            <section>
              <SectionLabel>Indexed documents</SectionLabel>
              <ul className="space-y-2">
                {completedDocs.map(doc => (
                  <li key={doc.document_id} className="border border-border rounded px-3 py-2.5 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <p className="text-2xs text-chart-2 mt-0.5">
                        {doc.entity_count} entities · {doc.relationship_count} relationships
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc)}
                      className="shrink-0 mt-0.5 text-chart-2 hover:text-foreground transition-colors"
                      title="Remove from graph"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {editor.graph.nodes.length > 0 && (
            <section>
              <SectionLabel>Graph</SectionLabel>
              <div className="flex items-center justify-between">
                <span className="text-xs text-chart-3">
                  {editor.graph.nodes.length} nodes · {editor.graph.links.length} edges
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => loadFullGraph()}
                    disabled={graphLoading}
                    className="text-xs text-chart-3 border border-border rounded px-3 py-1.5 hover:border-chart-3 hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    {graphLoading ? 'Loading…' : 'Reload'}
                  </button>
                  <button
                    onClick={() => { resetGraph(); setSelectedNode(null) }}
                    className="text-xs text-chart-2 border border-border rounded px-3 py-1.5 hover:border-chart-3 hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <SectionLabel>Ask</SectionLabel>
            <QueryPanel documentId={status?.document_id} onGraphContext={handleOverlayGraph} />
          </section>

        </div>
      </aside>

      {/* ── Canvas ── */}
      <div ref={canvasContainerRef} className="flex-1 relative bg-background">
        {editor.graph.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center select-none gap-4">
            <div className="text-center pointer-events-none">
              <p className="text-2xl font-bold text-border tracking-tight">No graph yet</p>
              <p className="text-sm text-chart-2 mt-2">Upload a PDF to extract entities and relationships</p>
            </div>
            <button
              onClick={() => loadSample(SAMPLE_GRAPH)}
              className="pointer-events-auto text-xs text-chart-3 border border-border rounded px-4 py-2 hover:border-chart-3 hover:text-foreground transition-colors"
            >
              Load sample graph
            </button>
          </div>
        ) : (
          <GraphCanvas
            data={editor.graph}
            selectedNodeId={selectedNode?.id ?? null}
            drillStack={editor.drillStack}
            onNodeClick={(node) => setSelectedNode(node.id === selectedNode?.id ? null : node)}
            onNodeDoubleClick={(node) => {
              const drilled = editor.drillDown(node)
              if (drilled) setSelectedNode(null)
            }}
            onDrillUp={() => { editor.drillUp(); setSelectedNode(null) }}
            onCreateNode={handleCanvasCreateNode}
            onEditNode={handleCanvasEditNode}
            onDeleteNode={handleCanvasDeleteNode}
            onCreateEdge={handleCanvasCreateEdge}
            onDeleteEdge={handleCanvasDeleteEdge}
            onUpdateEdge={handleCanvasUpdateEdge}
            width={canvasSize.width}
            height={canvasSize.height}
          />
        )}

        {editor.graph.nodes.length > 0 && <Legend />}

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            links={editor.graph.links}
            nodeMap={nodeMap}
            onClose={() => setSelectedNode(null)}
            onExpand={handleExpandNode}
            onAddEdge={handleAddEdgeRequest}
            onDeleteNode={handleDeleteNodeRequest}
            onDeleteEdge={handleDeleteEdgeRequest}
          />
        )}
      </div>

      {/* ── Modals (NodeInspector sidebar actions) ── */}
      {addNodeModal && (
        <AddNodeModal
          parentNode={addNodeModal.parentNode}
          onConfirm={handleAddNodeConfirm}
          onClose={() => setAddNodeModal(null)}
        />
      )}
      {addEdgeModal && (
        <AddEdgeModal
          sourceNode={addEdgeModal.sourceNode}
          allNodes={editor.graph.nodes}
          onConfirm={handleAddEdgeConfirm}
          onClose={() => setAddEdgeModal(null)}
        />
      )}
      {delNodeModal && (
        <DeleteNodeModal
          nodeName={delNodeModal.node.name}
          orphans={delNodeModal.orphans}
          onDeleteOnly={handleDeleteNodeOnly}
          onDeleteCascade={handleDeleteNodeCascade}
          onClose={() => setDelNodeModal(null)}
        />
      )}
      {delEdgeModal && (
        <DeleteEdgeModal
          relType={delEdgeModal.edge.type}
          sourceName={delEdgeModal.sourceName}
          targetName={delEdgeModal.targetName}
          orphanTarget={delEdgeModal.orphanTarget}
          onDeleteOnly={handleDeleteEdgeOnly}
          onDeleteCascade={handleDeleteEdgeCascade}
          onClose={() => setDelEdgeModal(null)}
        />
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold text-chart-2 uppercase tracking-widest mb-3">{children}</p>
}
