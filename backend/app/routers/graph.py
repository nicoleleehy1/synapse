"""Graph inspection and mutation endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_graph_store
from app.models import (
    CreateEdgeRequest,
    CreateNodeRequest,
    UpdateNodeRequest,
    EdgeOrphanInfo,
    GraphEdge,
    GraphNode,
    GraphResponse,
    OrphanInfo,
    Entity,
    Relationship,
)
from app.services.graph_store import GraphStore

router = APIRouter(prefix="/graph", tags=["graph"])


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=GraphResponse)
async def get_graph(
    document_id: Optional[str] = None,
    graph_store: GraphStore = Depends(get_graph_store),
):
    return graph_store.get_full_graph(document_id=document_id)


@router.get("/entity/{entity_id}", response_model=GraphResponse)
async def get_entity_neighbourhood(
    entity_id: str,
    depth: int = 2,
    graph_store: GraphStore = Depends(get_graph_store),
):
    if depth < 1 or depth > 3:
        raise HTTPException(status_code=400, detail="depth must be 1–3")
    return graph_store.get_entity_neighbourhood(entity_id, hop_depth=depth)


@router.post("/cypher")
async def run_cypher(
    body: dict,
    graph_store: GraphStore = Depends(get_graph_store),
):
    cypher = body.get("cypher", "")
    if not cypher:
        raise HTTPException(status_code=400, detail="cypher field required")
    stripped = cypher.strip().upper()
    if not stripped.startswith("MATCH") and not stripped.startswith("CALL"):
        raise HTTPException(status_code=400, detail="Only MATCH/CALL queries are allowed.")
    return graph_store.execute_cypher(cypher, body.get("params", {}))


# ── Orphan inspection (pre-delete checks) ─────────────────────────────────────

@router.get("/nodes/{entity_id}/orphans", response_model=OrphanInfo)
async def get_node_orphans(
    entity_id: str,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Returns nodes that would become isolated if this entity were deleted."""
    orphans = graph_store.get_orphaned_neighbors(entity_id)
    return OrphanInfo(orphaned_nodes=orphans)


@router.get("/edges/{edge_id}/orphan-target", response_model=EdgeOrphanInfo)
async def get_edge_orphan_target(
    edge_id: str,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Returns the target node of an edge if it would be isolated after deletion."""
    target = graph_store.get_edge_orphan_target(edge_id)
    return EdgeOrphanInfo(orphaned_target=target)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/nodes", response_model=GraphResponse)
async def create_node(
    body: CreateNodeRequest,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Create a new entity and optionally link it to an existing parent entity."""
    new_entity = Entity(
        name=body.name,
        type=body.type.upper(),
        description=body.description,
        source_document="Manual",
        source_chunk_ids=[],
    )
    graph_store.create_entity(new_entity)

    if body.parent_entity_id and body.relationship_type:
        if body.relationship_direction == "out":
            src_id, tgt_id = body.parent_entity_id, new_entity.id
        else:
            src_id, tgt_id = new_entity.id, body.parent_entity_id

        rel = Relationship(
            source_entity_id=src_id,
            target_entity_id=tgt_id,
            type=body.relationship_type.upper().replace(" ", "_"),
            confidence=body.confidence,
            source_chunk_id="",
            source_document="Manual",
        )
        graph_store.create_relationship(rel)

    # Return the immediate neighbourhood so the frontend can merge it in
    return graph_store.get_entity_neighbourhood(new_entity.id, hop_depth=1)


@router.patch("/nodes/{entity_id}", response_model=GraphNode)
async def update_node(
    entity_id: str,
    body: UpdateNodeRequest,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Partially update an entity's name, type, or description."""
    updated = graph_store.update_entity(entity_id, body.name, body.type, body.description)
    if not updated:
        raise HTTPException(status_code=404, detail="Entity not found")
    return updated


@router.post("/edges", response_model=GraphEdge)
async def create_edge(
    body: CreateEdgeRequest,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Create a relationship between two existing entities."""
    rel = Relationship(
        source_entity_id=body.source_entity_id,
        target_entity_id=body.target_entity_id,
        type=body.type.upper().replace(" ", "_"),
        description=body.description,
        confidence=body.confidence,
        source_chunk_id="",
        source_document="Manual",
    )
    graph_store.create_relationship(rel)
    return GraphEdge(
        id=rel.id,
        source=rel.source_entity_id,
        target=rel.target_entity_id,
        type=rel.type,
        description=rel.description,
        confidence=rel.confidence,
        source_document=rel.source_document,
    )


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/nodes/{entity_id}")
async def delete_node(
    entity_id: str,
    cascade: bool = False,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Delete an entity. cascade=true also removes fully-orphaned neighbours."""
    graph_store.delete_entity(entity_id, cascade=cascade)
    return {"deleted": entity_id, "cascade": cascade}


@router.delete("/edges/{edge_id}")
async def delete_edge(
    edge_id: str,
    cascade: bool = False,
    graph_store: GraphStore = Depends(get_graph_store),
):
    """Delete a relationship. cascade=true also removes the target if it becomes isolated."""
    graph_store.delete_edge(edge_id, delete_orphan_target=cascade)
    return {"deleted": edge_id, "cascade": cascade}
