import axios from 'axios'
import type {
  DocumentStatus, GraphData, QueryResponse,
  CreateNodePayload, UpdateNodePayload, CreateEdgePayload, GraphEdge, GraphNode,
  OrphanInfo, EdgeOrphanInfo,
} from '../types/graph'

const api = axios.create({ baseURL: '/api' })

export async function uploadPDF(file: File): Promise<{ document_id: string; filename: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/documents/upload', form)
  return data
}

export async function getDocumentStatus(documentId: string): Promise<DocumentStatus> {
  const { data } = await api.get(`/documents/${documentId}/status`)
  return data
}

export async function listDocuments(): Promise<DocumentStatus[]> {
  const { data } = await api.get('/documents/')
  return data
}

export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete(`/documents/${documentId}`)
}

export async function getFullGraph(documentId?: string): Promise<GraphData> {
  const params = documentId ? { document_id: documentId } : {}
  const { data } = await api.get('/graph/', { params })
  return data
}

export async function getEntityNeighbourhood(entityId: string, depth = 2): Promise<GraphData> {
  const { data } = await api.get(`/graph/entity/${entityId}`, { params: { depth } })
  return data
}

export async function runCypher(cypher: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const { data } = await api.post('/graph/cypher', { cypher, params })
  return data
}

export async function queryGraph(
  query: string,
  documentId?: string,
  topK = 5,
): Promise<QueryResponse> {
  const { data } = await api.post('/query/', {
    query,
    document_id: documentId,
    top_k: topK,
    hop_depth: 2,
  })
  return data
}

// ── Graph mutations ────────────────────────────────────────────────────────

export async function createNode(payload: CreateNodePayload): Promise<GraphData> {
  const { data } = await api.post('/graph/nodes', payload)
  return data
}

export async function updateNode(entityId: string, payload: UpdateNodePayload): Promise<GraphNode> {
  const { data } = await api.patch(`/graph/nodes/${entityId}`, payload)
  return data
}

export async function createEdge(payload: CreateEdgePayload): Promise<GraphEdge> {
  const { data } = await api.post('/graph/edges', payload)
  return data
}

export async function getNodeOrphans(entityId: string): Promise<OrphanInfo> {
  const { data } = await api.get(`/graph/nodes/${entityId}/orphans`)
  return data
}

export async function getEdgeOrphanTarget(edgeId: string): Promise<EdgeOrphanInfo> {
  const { data } = await api.get(`/graph/edges/${edgeId}/orphan-target`)
  return data
}

export async function deleteNode(entityId: string, cascade: boolean): Promise<void> {
  await api.delete(`/graph/nodes/${entityId}`, { params: { cascade } })
}

export async function deleteEdge(edgeId: string, cascade: boolean): Promise<void> {
  await api.delete(`/graph/edges/${edgeId}`, { params: { cascade } })
}
