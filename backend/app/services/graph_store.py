"""Neo4j graph storage layer."""

import logging
from contextlib import contextmanager
from typing import Any, Optional

from neo4j import GraphDatabase, Driver

from app.config import settings
from app.models import Entity, GraphEdge, GraphNode, GraphResponse, Relationship

logger = logging.getLogger(__name__)


class GraphStore:
    def __init__(self) -> None:
        self._driver: Optional[Driver] = None

    def connect(self) -> None:
        self._driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        self._driver.verify_connectivity()
        self._ensure_constraints()
        logger.info("Connected to Neo4j at %s", settings.neo4j_uri)

    def close(self) -> None:
        if self._driver:
            self._driver.close()

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def _ensure_constraints(self) -> None:
        with self._session() as s:
            s.run(
                "CREATE CONSTRAINT entity_id IF NOT EXISTS "
                "FOR (e:Entity) REQUIRE e.id IS UNIQUE"
            )
            s.run(
                "CREATE CONSTRAINT chunk_id IF NOT EXISTS "
                "FOR (c:Chunk) REQUIRE c.id IS UNIQUE"
            )

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def upsert_entity(self, entity: Entity) -> None:
        with self._session() as s:
            s.run(
                """
                MERGE (e:Entity {id: $id})
                SET e.name = $name,
                    e.type = $type,
                    e.description = $description,
                    e.source_document = $source_document,
                    e.aliases = $aliases,
                    e.source_chunk_ids = $chunk_ids
                """,
                id=entity.id,
                name=entity.name,
                type=entity.type,
                description=entity.description or "",
                source_document=entity.source_document,
                aliases=entity.aliases,
                chunk_ids=entity.source_chunk_ids,
            )

    def upsert_relationship(self, rel: Relationship) -> None:
        with self._session() as s:
            cypher = (
                "MATCH (src:Entity {id: $src_id}), (tgt:Entity {id: $tgt_id}) "
                "MERGE (src)-[r:RELATES {id: $id}]->(tgt) "
                "SET r.type = $type, "
                "    r.description = $description, "
                "    r.confidence = $confidence, "
                "    r.source_chunk_id = $chunk_id, "
                "    r.source_document = $source_document"
            )
            s.run(
                cypher,
                id=rel.id,
                src_id=rel.source_entity_id,
                tgt_id=rel.target_entity_id,
                type=rel.type,
                description=rel.description or "",
                confidence=rel.confidence,
                chunk_id=rel.source_chunk_id,
                source_document=rel.source_document,
            )

    def upsert_chunk_node(self, chunk_id: str, text: str, page: int, document_id: str, document_name: str) -> None:
        with self._session() as s:
            s.run(
                """
                MERGE (c:Chunk {id: $id})
                SET c.text = $text,
                    c.page_number = $page,
                    c.document_id = $document_id,
                    c.document_name = $document_name
                """,
                id=chunk_id,
                text=text,
                page=page,
                document_id=document_id,
                document_name=document_name,
            )

    def link_entity_to_chunk(self, entity_id: str, chunk_id: str) -> None:
        with self._session() as s:
            s.run(
                """
                MATCH (e:Entity {id: $eid}), (c:Chunk {id: $cid})
                MERGE (e)-[:MENTIONED_IN]->(c)
                """,
                eid=entity_id,
                cid=chunk_id,
            )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get_full_graph(self, document_id: Optional[str] = None) -> GraphResponse:
        with self._session() as s:
            if document_id:
                node_result = s.run(
                    "MATCH (e:Entity) WHERE $doc IN e.source_document OR e.source_document = $doc RETURN e",
                    doc=document_id,
                )
            else:
                node_result = s.run("MATCH (e:Entity) RETURN e LIMIT 500")

            nodes = [self._record_to_node(r["e"]) for r in node_result]
            node_ids = {n.id for n in nodes}

            edge_result = s.run(
                """
                MATCH (src:Entity)-[r:RELATES]->(tgt:Entity)
                WHERE src.id IN $ids AND tgt.id IN $ids
                RETURN r, src.id AS src_id, tgt.id AS tgt_id
                """,
                ids=list(node_ids),
            )
            edges = [self._record_to_edge(r["r"], r["src_id"], r["tgt_id"]) for r in edge_result]

        return GraphResponse(nodes=nodes, edges=edges)

    def get_entity_neighbourhood(self, entity_id: str, hop_depth: int = 2) -> GraphResponse:
        with self._session() as s:
            result = s.run(
                """
                MATCH path = (start:Entity {id: $id})-[:RELATES*1..$depth]-(neighbor:Entity)
                UNWIND nodes(path) AS n
                UNWIND relationships(path) AS r
                RETURN DISTINCT n, r,
                       startNode(r).id AS src_id,
                       endNode(r).id AS tgt_id
                """,
                id=entity_id,
                depth=hop_depth,
            )

            nodes_map: dict[str, GraphNode] = {}
            edges_map: dict[str, GraphEdge] = {}

            for record in result:
                node = self._record_to_node(record["n"])
                nodes_map[node.id] = node
                edge = self._record_to_edge(record["r"], record["src_id"], record["tgt_id"])
                edges_map[edge.id] = edge

        return GraphResponse(
            nodes=list(nodes_map.values()),
            edges=list(edges_map.values()),
        )

    def get_entities_for_chunks(self, chunk_ids: list[str]) -> list[str]:
        """Return entity IDs mentioned in the given chunks."""
        with self._session() as s:
            result = s.run(
                """
                MATCH (e:Entity)-[:MENTIONED_IN]->(c:Chunk)
                WHERE c.id IN $chunk_ids
                RETURN DISTINCT e.id AS eid
                """,
                chunk_ids=chunk_ids,
            )
            return [r["eid"] for r in result]

    def execute_cypher(self, cypher: str, params: Optional[dict] = None) -> list[dict]:
        with self._session() as s:
            result = s.run(cypher, **(params or {}))
            return [dict(r) for r in result]

    def delete_document(self, document_id: str, document_name: str) -> None:
        """Delete all graph data for a document.

        Entities are stored by filename (source_document), chunks by UUID (document_id).
        Both are required for a complete deletion.
        """
        with self._session() as s:
            s.run(
                "MATCH (e:Entity) WHERE e.source_document = $name DETACH DELETE e",
                name=document_name,
            )
            s.run(
                "MATCH (c:Chunk) WHERE c.document_id = $doc DETACH DELETE c",
                doc=document_id,
            )

    # ------------------------------------------------------------------
    # Manual graph mutations
    # ------------------------------------------------------------------

    def create_entity(self, entity: "Entity") -> None:  # type: ignore[name-defined]
        """Upsert a manually created entity (no chunk linkage required)."""
        self.upsert_entity(entity)

    def update_entity(
        self,
        entity_id: str,
        name: Optional[str],
        type_: Optional[str],
        description: Optional[str],
    ) -> Optional[GraphNode]:
        """Partially update an existing entity and return the updated node."""
        sets: list[str] = []
        params: dict = {"id": entity_id}
        if name is not None:
            sets.append("e.name = $name")
            params["name"] = name
        if type_ is not None:
            sets.append("e.type = $type")
            params["type"] = type_.upper()
        if description is not None:
            sets.append("e.description = $description")
            params["description"] = description
        with self._session() as s:
            if sets:
                result = s.run(
                    f"MATCH (e:Entity {{id: $id}}) SET {', '.join(sets)} RETURN e",
                    **params,
                )
            else:
                result = s.run("MATCH (e:Entity {id: $id}) RETURN e", id=entity_id)
            record = result.single()
            return self._record_to_node(record["e"]) if record else None

    def create_relationship(self, rel: "Relationship") -> None:  # type: ignore[name-defined]
        """Upsert a manually created relationship."""
        with self._session() as s:
            s.run(
                """
                MATCH (src:Entity {id: $src_id}), (tgt:Entity {id: $tgt_id})
                MERGE (src)-[r:RELATES {id: $id}]->(tgt)
                SET r.type          = $type,
                    r.description   = $description,
                    r.confidence    = $confidence,
                    r.source_chunk_id  = '',
                    r.source_document  = $source_document
                """,
                id=rel.id,
                src_id=rel.source_entity_id,
                tgt_id=rel.target_entity_id,
                type=rel.type,
                description=rel.description or "",
                confidence=rel.confidence,
                source_document=rel.source_document,
            )

    # ------------------------------------------------------------------
    # Orphan detection
    # ------------------------------------------------------------------

    def get_orphaned_neighbors(self, entity_id: str) -> list:
        """Return neighbor nodes that would become isolated if entity_id is deleted.

        A neighbor is orphaned when ALL of its relationships connect only to the
        node being deleted — i.e. it has no other connections.
        """
        with self._session() as s:
            result = s.run(
                """
                MATCH (n:Entity {id: $entity_id})-[:RELATES]-(neighbor:Entity)
                WITH n, neighbor,
                     size([(neighbor)-[:RELATES]-(other:Entity)
                            WHERE other.id <> $entity_id | 1]) AS others
                WHERE others = 0
                RETURN DISTINCT neighbor
                """,
                entity_id=entity_id,
            )
            return [self._record_to_node(r["neighbor"]) for r in result]

    def get_edge_orphan_target(self, edge_id: str):
        """Return the *target* of an edge if deleting that edge would leave it isolated."""
        with self._session() as s:
            result = s.run(
                """
                MATCH (src:Entity)-[r:RELATES {id: $edge_id}]->(tgt:Entity)
                WITH tgt, size([(tgt)-[:RELATES]-() | 1]) AS total
                WHERE total = 1
                RETURN tgt
                """,
                edge_id=edge_id,
            )
            record = result.single()
            return self._record_to_node(record["tgt"]) if record else None

    # ------------------------------------------------------------------
    # Delete entity / edge
    # ------------------------------------------------------------------

    def delete_entity(self, entity_id: str, cascade: bool = False) -> None:
        """Delete an entity.

        cascade=True  — also delete any neighbor nodes that would become
                        fully isolated after this deletion.
        cascade=False — only detach and delete this node; leave neighbors.
        """
        with self._session() as s:
            if cascade:
                s.run(
                    """
                    MATCH (n:Entity {id: $entity_id})-[:RELATES]-(neighbor:Entity)
                    WITH n, neighbor,
                         size([(neighbor)-[:RELATES]-(other:Entity)
                                WHERE other.id <> $entity_id | 1]) AS others
                    WHERE others = 0
                    DETACH DELETE neighbor
                    """,
                    entity_id=entity_id,
                )
            s.run("MATCH (e:Entity {id: $id}) DETACH DELETE e", id=entity_id)

    def delete_edge(self, edge_id: str, delete_orphan_target: bool = False) -> None:
        """Delete a relationship edge.

        delete_orphan_target=True — also delete the target node if it has no
                                    other connections after this edge is removed.
        """
        with self._session() as s:
            if delete_orphan_target:
                s.run(
                    """
                    MATCH (src:Entity)-[r:RELATES {id: $edge_id}]->(tgt:Entity)
                    WITH r, tgt, size([(tgt)-[:RELATES]-() | 1]) AS total
                    DELETE r
                    WITH tgt, total
                    WHERE total = 1
                    DETACH DELETE tgt
                    """,
                    edge_id=edge_id,
                )
            else:
                s.run(
                    "MATCH ()-[r:RELATES {id: $id}]-() DELETE r",
                    id=edge_id,
                )

    # ------------------------------------------------------------------

    @contextmanager
    def _session(self):
        session = self._driver.session()
        try:
            yield session
        finally:
            session.close()

    @staticmethod
    def _record_to_node(node) -> GraphNode:
        props = dict(node)
        return GraphNode(
            id=props["id"],
            name=props.get("name", ""),
            type=props.get("type", "OTHER"),
            description=props.get("description") or None,
            source_document=props.get("source_document", ""),
            chunk_count=len(props.get("source_chunk_ids", [])),
        )

    @staticmethod
    def _record_to_edge(rel, src_id: str, tgt_id: str) -> GraphEdge:
        props = dict(rel)
        return GraphEdge(
            id=props["id"],
            source=src_id,
            target=tgt_id,
            type=props.get("type", "RELATES"),
            description=props.get("description") or None,
            confidence=float(props.get("confidence", 1.0)),
            source_document=props.get("source_document", ""),
        )
