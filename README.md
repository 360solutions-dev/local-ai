# Offline Document Chatbot

A RAG-based chatbot that runs fully offline using [Ollama](https://ollama.com). Upload PDF, DOCX, or TXT documents and ask questions; answers are based only on the content you uploaded.

## Prerequisites

- **Python** 3.10+
- **Ollama** installed and running ([ollama.com](https://ollama.com))
- **RAM:** 16 GB recommended (8 GB minimum with a smaller model)

## Setup

### 1. Install Ollama and pull models

```bash
# Install Ollama (macOS / Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull embedding model (required for document search)
ollama pull nomic-embed-text

# Pull chat model (default: Llama 3.1 8B)
ollama pull llama3.1:8b

# Optional: for low-RAM machines use a smaller model
# ollama pull llama3.2:3b
```

Verify:

```bash
ollama list
```

### 2. Python environment

Use the project’s **virtual environment** so you don’t get “externally-managed-environment” errors:

**Option A — Activate venv, then pip:**
```bash
cd /path/to/oll
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Option B — Use the venv’s pip without activating (no need to type `source venv/bin/activate`):**
```bash
cd /path/to/oll
./venv/bin/pip install -r requirements.txt
./venv/bin/python run_migrations.py
./venv/bin/streamlit run app.py
```

### 3. Run the app

Ensure Ollama is running (start the Ollama app or run `ollama serve`). Then:

```bash
streamlit run app.py
```

Open the URL shown (e.g. http://localhost:8501). Upload documents in the sidebar, click **Process / Ingest**, then ask questions in the chat.

## Usage

1. **Upload** — In the sidebar, choose one or more PDF, DOCX, or TXT files.
2. **Process / Ingest** — Click to extract text, chunk, embed, and store in a local FAISS index.
3. **Ask** — Type questions in the chat. Answers are generated from your documents only.

Document indexes are stored under `./vector_db` (one folder per ingest). User queries are optionally logged to PostgreSQL (see below).

## Configuration

Edit `config.py` to change:

- `LLM_MODEL` — Ollama chat model (e.g. `llama3.1:8b`, `llama3.2:3b`).
- `EMBEDDING_MODEL` — Embedding model (keep `nomic-embed-text` unless you have another).
- `CHUNK_SIZE` / `CHUNK_OVERLAP` — Document chunking for RAG.
- `TOP_K` — Number of chunks retrieved per question.
- `OLLAMA_BASE_URL` — Set if Ollama runs on another machine (e.g. `http://server:11434`).
- `PERSIST_DIRECTORY` — Base folder for FAISS indexes (default `./vector_db`).
- `DATABASE_URL` — PostgreSQL connection string for query history (leave empty to disable).

## Query history (PostgreSQL)

To save user prompts/queries, set `DATABASE_URL` in `config.py` to a PostgreSQL connection string, e.g.:

```text
postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

If `DATABASE_URL` is empty, query logging is skipped and the app runs without PostgreSQL.

### Tables required for prompts and chatbot

| Table           | Purpose |
|-----------------|--------|
| **query_history** | Stores each user prompt/query when they ask a question. Columns: `id`, `query_text`, `created_at`. |

No other tables are needed. Document indexes live in FAISS (local); the LLM runs in Ollama.

### Database migrations

Migrations are in `migrations/`. Run them once to create the schema:

**Option 1 — Python (uses `config.DATABASE_URL`):**
```bash
source venv/bin/activate   # or venv\Scripts\activate on Windows
python run_migrations.py
```

**Option 2 — psql:**
```bash
psql "postgresql://postgres:admin@localhost:5432/llm-ops-backend" -f migrations/001_create_query_history.sql
```

**Option 3 — DB client:** Open `migrations/001_create_query_history.sql` in your PostgreSQL client and execute it against the `llm-ops-backend` database.

## LAN deployment

To allow other devices on the same network to use the chatbot:

```bash
streamlit run app.py --server.address 0.0.0.0
```

Then open `http://<this-machine-ip>:8501` from other computers. No cloud or API keys required; everything runs locally.

## Offline use

After Ollama and the Python app are installed and models are pulled, you can disconnect from the internet. The chatbot continues to work offline.
