# Standalone RAG service (without full Docker stack)

The primary way to run this project is **Docker Compose** — see [INSTALL.md](INSTALL.md).

For development or minimal setups, the **RAG** document chatbot lives under [`rag/`](../rag/): Streamlit UI + FastAPI, using Ollama embeddings and a local FAISS index.

## Prerequisites

- Python 3.10+
- [Ollama](https://ollama.com) installed and running on the host
- Models pulled on the host, for example:

  ```bash
  ollama pull nomic-embed-text
  ollama pull llama3.1:8b
  ```

## Run locally

```bash
cd rag
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Point `OLLAMA_BASE_URL` in [`rag/config.py`](../rag/config.py) at `http://localhost:11434` (default) if Ollama runs on the same machine.

```bash
# Terminal 1 — API (optional; Docker stack uses this on 8080)
uvicorn api.main:app --host 0.0.0.0 --port 8080

# Terminal 2 — Streamlit UI
streamlit run app.py --server.port 8501
```

Open [http://localhost:8501](http://localhost:8501), upload documents, then ask questions.

Indexes are stored under `rag/vector_db/` (or paths configured in `rag/config.py`). This path is separate from the full-app Docker volumes.

## PostgreSQL (optional)

If you set `DATABASE_URL` in `rag/config.py`, run SQL migrations from [`rag/migrations/`](../rag/migrations/) using your project’s migration runner or `psql` — see [`rag/migrations/README.md`](../rag/migrations/README.md).
