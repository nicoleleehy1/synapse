export interface GraphNode {
  id: string
  name: string
  type: string
  description?: string
  source_document: string
  chunk_count: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  description?: string
  confidence: number
  source_document: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface DocumentStatus {
  document_id: string
  filename: string
  status: 'uploading' | 'processing' | 'complete' | 'error'
  page_count: number
  chunk_count: number
  entity_count: number
  relationship_count: number
  error?: string
}

export interface SourceChunk {
  chunk_id: string
  text: string
  page_number: number
  document_name: string
  similarity_score: number
}

export interface QueryResponse {
  answer: string
  sources: SourceChunk[]
  graph_context: GraphData
  cypher_used?: string
}

// react-force-graph-2d node/link format
export interface FGNode extends GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
  color?: string
  textColor?: string
  val?: number
}

export interface FGLink {
  id: string
  source: string | FGNode
  target: string | FGNode
  type: string
  description?: string
  confidence: number
  source_document: string
  color?: string
}

export interface FGData {
  nodes: FGNode[]
  links: FGLink[]
}

// Mutation payloads
export interface CreateNodePayload {
  name: string
  type: string
  description?: string
  parent_entity_id?: string
  relationship_type?: string
  relationship_direction?: 'out' | 'in'
  confidence?: number
}

export interface UpdateNodePayload {
  name?: string
  type?: string
  description?: string
}

export interface CreateEdgePayload {
  source_entity_id: string
  target_entity_id: string
  type: string
  description?: string
  confidence: number
}

export interface OrphanInfo {
  orphaned_nodes: GraphNode[]
}

export interface EdgeOrphanInfo {
  orphaned_target: GraphNode | null
}
