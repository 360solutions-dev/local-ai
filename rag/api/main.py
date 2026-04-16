"""FastAPI REST layer for local-ai: health, CORS, future RAG + DB routes."""

import os
import sys
from pathlib import Path

# Repo root (parent of api/)
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
import tempfile
import uuid

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel as PydanticModel

app = FastAPI(title="local-ai API", version="0.1.0")

# --- API key authentication ---
RAG_API_KEY = os.environ.get("RAG_API_KEY", "")


def verify_api_key(x_api_key: str = Header(default="", alias="X-API-Key")):
    """Verify the shared API key sent by Django backend."""
    if RAG_API_KEY and x_api_key != RAG_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return x_api_key

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_origins_list = [o.strip() for o in _origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ollama_reachable() -> bool:
    try:
        import urllib.request

        from config import OLLAMA_BASE_URL

        url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        with urllib.request.urlopen(url, timeout=2) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _db_reachable() -> bool:
    try:
        from config import DATABASE_URL

        if not DATABASE_URL:
            return False
        import psycopg2

        conn = psycopg2.connect(DATABASE_URL, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@app.get("/api/health")
def health():
    """Liveness + dependency checks for dashboard / ops."""
    ollama_ok = _ollama_reachable()
    db_ok = _db_reachable()
    return {
        "status": "ok" if (ollama_ok and db_ok) else "degraded",
        "ollama": ollama_ok,
        "database": db_ok,
    }


@app.get("/api/health/live")
def health_live():
    return {"status": "ok"}


@app.get("/api/models", dependencies=[Depends(verify_api_key)])
def list_models():
    """List models installed in Ollama."""
    try:
        import urllib.request

        from config import OLLAMA_BASE_URL

        url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            models = []
            for m in data.get("models", []):
                name = m.get("name", "")
                size_bytes = m.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 1)
                # Skip embedding models
                if "embed" in name.lower():
                    continue
                models.append({
                    "id": name,
                    "name": name,
                    "size": f"{size_gb} GB",
                    "modified": m.get("modified_at", ""),
                })
            return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.get("/api/models/all", dependencies=[Depends(verify_api_key)])
def list_all_models():
    """List every model in Ollama (including embedding models) for admin UI."""
    try:
        import urllib.request

        from config import OLLAMA_BASE_URL

        url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            models = []
            for m in data.get("models", []):
                name = m.get("name", "")
                size_bytes = m.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 2) if size_bytes else 0
                models.append({
                    "id": name,
                    "name": name,
                    "size": f"{size_gb} GB" if size_gb >= 0.01 else f"{round(size_bytes / (1024 ** 2))} MB",
                    "modified": m.get("modified_at", ""),
                })
            return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}


class PullModelRequest(PydanticModel):
    name: str


@app.post("/api/models/pull", dependencies=[Depends(verify_api_key)])
def pull_model(req: PullModelRequest):
    """Pull a model from Ollama with streaming progress via SSE."""
    import http.client
    from urllib.parse import urlparse

    from fastapi.responses import StreamingResponse

    from config import OLLAMA_BASE_URL

    parsed = urlparse(OLLAMA_BASE_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 11434
    payload = json.dumps({"name": req.name, "stream": True})

    def stream_progress():
        conn = None
        try:
            conn = http.client.HTTPConnection(host, port, timeout=600)
            conn.request("POST", "/api/pull", body=payload, headers={"Content-Type": "application/json"})
            resp = conn.getresponse()

            # Read line by line for real-time streaming
            while True:
                line = resp.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    status_text = data.get("status", "")
                    total = data.get("total", 0)
                    completed = data.get("completed", 0)
                    pct = 0
                    if total > 0:
                        pct = min(round(completed / total * 100), 100)
                    event = json.dumps({
                        "status": status_text,
                        "percent": pct,
                        "total": total,
                        "completed": completed,
                    })
                    yield f"data: {event}\n\n"
                except json.JSONDecodeError:
                    continue
            yield f"data: {json.dumps({'status': 'success', 'percent': 100})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"
        finally:
            if conn:
                conn.close()

    return StreamingResponse(stream_progress(), media_type="text/event-stream")


@app.delete("/api/models/{model_name}", dependencies=[Depends(verify_api_key)])
def delete_model(model_name: str):
    """Delete a model from Ollama."""
    import urllib.request

    from config import OLLAMA_BASE_URL

    url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/delete"
    payload = json.dumps({"name": model_name}).encode()
    try:
        request = urllib.request.Request(
            url, data=payload, headers={"Content-Type": "application/json"}, method="DELETE"
        )
        with urllib.request.urlopen(request, timeout=30) as resp:
            return {"status": "deleted", "model": model_name}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# Chat / RAG endpoint — called by Django to generate AI answers
# ---------------------------------------------------------------------------

class AskRequest(PydanticModel):
    question: str
    model: str | None = None
    base_url: str | None = None
    provider_type: str | None = None  # "ollama" or "openai"
    file_filter: str | None = None


# ---------------------------------------------------------------------------
# Cached FAISS index + embeddings — loaded once, reused across requests
# ---------------------------------------------------------------------------

import threading

_index_lock = threading.Lock()
_cached_embeddings = None
_cached_vs = None
_cached_index_mtime = None


def _get_cached_index():
    """Return cached FAISS vector store and embeddings. Reload if index file changed."""
    global _cached_embeddings, _cached_vs, _cached_index_mtime

    from config import EMBEDDING_MODEL, OLLAMA_BASE_URL, PERSIST_DIRECTORY

    store_path = Path(PERSIST_DIRECTORY)
    index_file = store_path / "index.faiss"

    if not store_path.exists() or not index_file.exists():
        return None, None

    current_mtime = index_file.stat().st_mtime

    with _index_lock:
        if _cached_vs is not None and _cached_index_mtime == current_mtime:
            return _cached_embeddings, _cached_vs

        from langchain_community.vectorstores import FAISS
        from langchain_ollama import OllamaEmbeddings

        embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL, base_url=OLLAMA_BASE_URL)
        vs_loaded = FAISS.load_local(
            str(store_path), embeddings, allow_dangerous_deserialization=True
        )
        _cached_embeddings = embeddings
        _cached_vs = vs_loaded
        _cached_index_mtime = current_mtime
        return _cached_embeddings, _cached_vs


def invalidate_index_cache():
    """Clear cached index so next request reloads from disk."""
    global _cached_vs, _cached_embeddings, _cached_index_mtime
    with _index_lock:
        _cached_vs = None
        _cached_embeddings = None
        _cached_index_mtime = None


@app.post("/api/ask", dependencies=[Depends(verify_api_key)])
def ask_question(req: AskRequest):
    """Run RAG: retrieve relevant docs and generate an answer via the configured provider."""
    from config import LLM_MODEL, OLLAMA_BASE_URL, TOP_K

    from rag_chain import answer_question
    from vector_store import VectorStoreManager

    llm_model = req.model or LLM_MODEL
    llm_base_url = req.base_url or OLLAMA_BASE_URL
    llm_provider_type = req.provider_type or "ollama"

    embeddings, cached_vs = _get_cached_index()
    if cached_vs is None:
        return {
            "answer": "No documents have been indexed yet. Please upload and index files first to get AI-powered answers.",
            "sources": [],
        }

    try:
        vs = VectorStoreManager()
        vs._vector_store = cached_vs
        retrieve_k = TOP_K * 3 if req.file_filter else TOP_K
        retriever = vs.get_retriever(k=retrieve_k)
        answer, docs = answer_question(
            question=req.question, retriever=retriever, model=llm_model,
            base_url=llm_base_url, provider_type=llm_provider_type,
            file_filter=req.file_filter,
        )

        sources = list(dict.fromkeys(
            d.metadata.get("filename", d.metadata.get("source", "unknown"))
            for d in docs
        ))
        return {"answer": answer, "sources": sources}
    except Exception as e:
        return {"answer": f"Error generating response: {e}", "sources": [], "error": str(e)}


# ---------------------------------------------------------------------------
# File metadata storage (PostgreSQL)
# ---------------------------------------------------------------------------

from query_history import (
    add_indexed_file,
    delete_indexed_file,
    ensure_indexed_files_table,
    list_indexed_files,
)

_files_table_ready = False


def _ensure_files_table():
    global _files_table_ready
    if not _files_table_ready:
        _files_table_ready = ensure_indexed_files_table()
    return _files_table_ready


# ---------------------------------------------------------------------------
# File upload endpoint
# ---------------------------------------------------------------------------

@app.post("/api/files/upload", dependencies=[Depends(verify_api_key)])
async def upload_file(
    file: UploadFile = File(...),
    embedding_model: str = Form(""),
):
    """Upload a document, process it, and add to the vector index."""
    from config import EMBEDDING_MODEL as DEFAULT_EMBEDDING
    from config import OLLAMA_BASE_URL, PERSIST_DIRECTORY

    effective_embedding = (embedding_model or "").strip() or DEFAULT_EMBEDDING
    from document_loader import DocumentProcessor
    from vector_store import VectorStoreManager

    # Validate file type
    allowed = {".pdf", ".docx", ".doc", ".txt", ".md", ".csv"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed:
        return {"error": f"Unsupported file type: {suffix}", "supported": list(allowed)}

    # Save to temp file
    content = await file.read()
    file_size = len(content)

    # .md and .csv are loaded as text
    save_suffix = ".txt" if suffix in (".md", ".csv") else suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=save_suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Process document into chunks
        processor = DocumentProcessor()
        chunks = processor.process_documents([tmp_path])

        if not chunks:
            return {"error": "No content could be extracted from the file."}

        # Deduplicate chunks with identical content
        seen = set()
        unique_chunks = []
        for chunk in chunks:
            key = chunk.page_content.strip()
            if key not in seen:
                seen.add(key)
                unique_chunks.append(chunk)
        chunks = unique_chunks

        # Update filename metadata to use original name
        for chunk in chunks:
            chunk.metadata["filename"] = file.filename
            chunk.metadata["source"] = file.filename

        # Load existing index or create new one
        store_path = Path(PERSIST_DIRECTORY)
        from langchain_community.vectorstores import FAISS
        from langchain_ollama import OllamaEmbeddings

        embeddings = OllamaEmbeddings(model=effective_embedding, base_url=OLLAMA_BASE_URL)

        if store_path.exists() and (store_path / "index.faiss").exists():
            existing_vs = FAISS.load_local(
                str(store_path), embeddings, allow_dangerous_deserialization=True
            )
            existing_vs.add_documents(chunks)
            existing_vs.save_local(str(store_path))
        else:
            store_path.mkdir(parents=True, exist_ok=True)
            new_vs = FAISS.from_documents(chunks, embeddings)
            new_vs.save_local(str(store_path))

        # Save file metadata to database
        _ensure_files_table()
        file_id = uuid.uuid4().hex[:12]
        file_meta = {
            "id": file_id,
            "name": file.filename,
            "size": file_size,
            "chunks": len(chunks),
            "type": suffix,
        }
        if not add_indexed_file(file_id, file.filename, file_size, len(chunks), suffix):
            return {"error": "Failed to save file metadata to database."}

        # Invalidate cached index so next /api/ask reloads with new documents
        invalidate_index_cache()

        # Keep module-level embedding in sync so /api/ask loads the index with the same model.
        import config as rag_config

        rag_config.EMBEDDING_MODEL = effective_embedding

        return {"file": file_meta}

    except Exception as e:
        return {"error": str(e)}
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/api/files", dependencies=[Depends(verify_api_key)])
def list_files():
    """List all indexed files."""
    _ensure_files_table()
    files = list_indexed_files()
    return {"files": files}


@app.delete("/api/files/{file_id}", dependencies=[Depends(verify_api_key)])
def delete_file(file_id: str):
    """Remove a file from the metadata."""
    _ensure_files_table()
    if not delete_indexed_file(file_id):
        return {"error": "File not found."}
    return {"message": "File removed."}


@app.get("/api/storage-info", dependencies=[Depends(verify_api_key)])
def storage_info():
    """Return storage sizes for vector DB and indexed files."""
    import shutil

    from config import PERSIST_DIRECTORY

    # Vector DB directory size
    vector_db_bytes = 0
    store_path = Path(PERSIST_DIRECTORY)
    if store_path.exists():
        for f in store_path.rglob("*"):
            if f.is_file():
                vector_db_bytes += f.stat().st_size

    # Indexed files total size from DB
    uploaded_files_bytes = 0
    try:
        _ensure_files_table()
        files = list_indexed_files()
        uploaded_files_bytes = sum(f.get("size", 0) for f in files)
    except Exception:
        pass

    # Host disk usage (container sees the host filesystem)
    disk = shutil.disk_usage("/")

    return {
        "vector_db_bytes": vector_db_bytes,
        "uploaded_files_bytes": uploaded_files_bytes,
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "disk_free_bytes": disk.free,
    }


@app.post("/api/clear-cache", dependencies=[Depends(verify_api_key)])
def clear_cache():
    """Clear vector DB cache files and in-memory caches."""
    import shutil

    from config import PERSIST_DIRECTORY

    cleared_bytes = 0
    store_path = Path(PERSIST_DIRECTORY)
    if store_path.exists():
        for f in store_path.rglob("*"):
            if f.is_file():
                cleared_bytes += f.stat().st_size
        shutil.rmtree(store_path, ignore_errors=True)

    invalidate_index_cache()

    return {"message": "Cache cleared.", "cleared_bytes": cleared_bytes}


@app.post("/api/reset", dependencies=[Depends(verify_api_key)])
def factory_reset():
    """Delete all indexed files metadata, vector store data, Ollama models, and clear caches."""
    import shutil
    import urllib.request

    from config import EMBEDDING_MODEL, OLLAMA_BASE_URL, PERSIST_DIRECTORY
    from query_history import delete_all_indexed_files

    errors = []

    # 1. Delete all file metadata from DB
    delete_all_indexed_files()

    # 2. Delete the vector store directory
    store_path = Path(PERSIST_DIRECTORY)
    if store_path.exists():
        shutil.rmtree(store_path, ignore_errors=True)

    # 3. Clear in-memory caches
    invalidate_index_cache()

    # 4. Delete all Ollama models (except the embedding model)
    try:
        tags_url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        with urllib.request.urlopen(tags_url, timeout=5) as resp:
            data = json.loads(resp.read())
        for m in data.get("models", []):
            name = m.get("name", "")
            if not name:
                continue
            # Keep the embedding model — it's required for RAG to work
            if EMBEDDING_MODEL and EMBEDDING_MODEL in name:
                continue
            try:
                delete_url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/delete"
                payload = json.dumps({"name": name}).encode()
                req = urllib.request.Request(
                    delete_url, data=payload,
                    headers={"Content-Type": "application/json"},
                    method="DELETE",
                )
                urllib.request.urlopen(req, timeout=30)
            except Exception as e:
                errors.append(f"Failed to delete model {name}: {e}")
    except Exception as e:
        errors.append(f"Failed to list Ollama models: {e}")

    result = {"message": "Factory reset complete."}
    if errors:
        result["warnings"] = errors
    return result
