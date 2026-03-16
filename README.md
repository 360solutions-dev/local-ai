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

```bash
cd /path/to/oll
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Run the app

Ensure Ollama is running (start the Ollama app or run `ollama serve`). Then:

```bash
streamlit run app.py
```

Open the URL shown (e.g. http://localhost:8501). Upload documents in the sidebar, click **Process / Ingest**, then ask questions in the chat.

## Usage

1. **Upload** — In the sidebar, choose one or more PDF, DOCX, or TXT files.
2. **Process / Ingest** — Click to extract text, chunk, embed, and store in the local vector DB.
3. **Ask** — Type questions in the chat. Answers are generated from your documents only.

Data is stored in `./vector_db` and persists between runs. To start over, delete the `vector_db` folder.

## Configuration

Edit `config.py` to change:

- `LLM_MODEL` — Ollama chat model (e.g. `llama3.1:8b`, `llama3.2:3b`).
- `EMBEDDING_MODEL` — Embedding model (keep `nomic-embed-text` unless you have another).
- `CHUNK_SIZE` / `CHUNK_OVERLAP` — Document chunking for RAG.
- `TOP_K` — Number of chunks retrieved per question.
- `OLLAMA_BASE_URL` — Set if Ollama runs on another machine (e.g. `http://server:11434`).

##  LAN deployment

To allow other devices on the same network to use the chatbot:

```bash
streamlit run app.py --server.address 0.0.0.0
```

Then open `http://<this-machine-ip>:8501` from other computers. No cloud or API keys required; everything runs locally.

## Offline use

After Ollama and the Python app are installed and models are pulled, you can disconnect from the internet. The chatbot continues to work offline.
