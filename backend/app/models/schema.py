from pydantic import BaseModel, Field
from typing import Optional
import uuid


def _id() -> str:
    return str(uuid.uuid4())


class TextChunk(BaseModel):
    id: str = Field(default_factory=_id)
    text: str
    page_number: int
    document_id: str
    document_name: str
    char_start: int
    char_end: int
    token_count: int


class Entity(BaseModel):
    id: str = Field(default_factory=_id)
    name: str
    type: str  # PERSON, ORGANIZATION, CONCEPT, LOCATION, EVENT, TECHNOLOGY, OTHER
    description: Optional[str] = None
    source_document: str
    source_chunk_ids: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)


class Relationship(BaseModel):
    id: str = Field(default_factory=_id)
    source_entity_id: str
    target_entity_id: str
    type: str  # e.g. WORKS_AT, RELATED_TO, CAUSES, PART_OF, AUTHORED, etc.
    description: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    source_chunk_id: str
    source_document: str


class ExtractionResult(BaseModel):
    entities: list[Entity]
    relationships: list[Relationship]


class DocumentStatus(BaseModel):
    document_id: str
    filename: str
    status: str  # uploading | processing | complete | error
    page_count: int = 0
    chunk_count: int = 0
    entity_count: int = 0
    relationship_count: int = 0
    error: Optional[str] = None


# --- API models ---

class UploadResponse(BaseModel):
    document_id: str
    filename: str
    message: str


class GraphNode(BaseModel):
    id: str
    name: str
    type: str
    description: Optional[str] = None
    source_document: str
    chunk_count: int = 0


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    description: Optional[str] = None
    confidence: float
    source_document: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class QueryRequest(BaseModel):
    query: str
    document_id: Optional[str] = None
    top_k: int = Field(default=5, ge=1, le=20)
    hop_depth: int = Field(default=2, ge=1, le=3)


class SourceChunk(BaseModel):
    chunk_id: str
    text: str
    page_number: int
    document_name: str
    similarity_score: float


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    graph_context: GraphResponse
    cypher_used: Optional[str] = None


# --- Graph mutation models ---

class CreateNodeRequest(BaseModel):
    name: str
    type: str = "CONCEPT"
    description: Optional[str] = None
    parent_entity_id: Optional[str] = None
    relationship_type: Optional[str] = None
    relationship_direction: str = "out"   # "out" = parent→new, "in" = new→parent
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)


class UpdateNodeRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None


class CreateEdgeRequest(BaseModel):
    source_entity_id: str
    target_entity_id: str
    type: str
    description: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)


class OrphanInfo(BaseModel):
    orphaned_nodes: list[GraphNode] = Field(default_factory=list)


class EdgeOrphanInfo(BaseModel):
    orphaned_target: Optional[GraphNode] = None
