# Synapse AI
From document to memory, instantly.
An AI learning tool that converts documents into personalized knowledge graphs, flashcards, and visualizations to help students retain and memorize information more effectively.

## DEMO
<img src="https://github.com/user-attachments/assets/cf4ff867-2977-4a67-aeaf-cfb84221dfe3"/>
<img src="https://github.com/user-attachments/assets/500ebe43-58c7-4cdf-ad8c-d95105bd21ce"/>


## Architecture

```
backend/
  app/
    services/
      pdf_processor.py   — PyMuPDF text extraction + cleaning
      chunker.py         — Token-aware overlapping chunker (300–800 tokens)
      extractor.py       — Claude-powered entity/relationship extraction
      resolver.py        — Embedding-based entity deduplication
      graph_store.py     — Neo4j read/write layer
      vector_store.py    — FAISS chunk embeddings
      retriever.py       — Hybrid vector + graph retrieval + LLM answer
      pipeline.py        — Orchestrates the full PDF → graph flow
    routers/
      documents.py       — Upload, status, list, delete
      graph.py           — Graph inspection, neighbourhood expansion, raw Cypher
      query.py           — Natural language Q&A endpoint

frontend/
  src/
    components/
      FileUpload.tsx      — Drag-and-drop PDF upload with live status
      GraphCanvas.tsx     — react-force-graph-2d interactive canvas
      NodeInspector.tsx   — Node detail panel (relationships, source, expand)
      QueryPanel.tsx      — NL query with answer + source chunks + Cypher
      Legend.tsx          — Entity type colour legend
    hooks/
      useDocumentUpload.ts — Upload + polling for processing status
      useGraphData.ts      — Graph state, node expansion, overlay
```

## Quick Start

### Prerequisites
- Docker + Docker Compose
- An Anthropic API key

### Run with Docker
```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/docs
- Neo4j Browser: http://localhost:7474 (user: neo4j / pass: password)

### Run locally (development)

**Backend**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in ANTHROPIC_API_KEY
uvicorn app.main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Neo4j must be running. Quickest way:
```bash
docker run -d -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5.25-community
```

## Usage

1. **Upload** a PDF — the pipeline extracts text, chunks it, calls Claude for entities/relationships, deduplicates with embeddings, and stores everything in Neo4j + FAISS.
2. **Explore** the graph — click any node to inspect its relationships and expand its neighbourhood.
3. **Query** in natural language — the hybrid retriever finds the most relevant chunks via FAISS, expands the subgraph around mentioned entities in Neo4j, and generates a grounded answer with source citations.

## Key Design Decisions

| Concern | Choice | Reason |
|---|---|---|
| Extraction | Claude (claude-sonnet-4-6) | Structured JSON output, high accuracy |
| Embeddings | all-MiniLM-L6-v2 | Fast, small, runs locally |
| Entity resolution | Cosine similarity ≥ 0.88 + same type | Avoids false merges across types |
| Vector store | FAISS (IndexFlatIP on L2-normalised) | Zero-dependency, cosine similarity |
| Graph DB | Neo4j 5 | Native graph traversal, Cypher |
| Retrieval | FAISS top-k → entity lookup → Neo4j BFS | Semantic + structural context |
