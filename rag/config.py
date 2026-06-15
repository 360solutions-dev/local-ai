"""Configuration for the offline document chatbot."""
import os

# Ollama
OLLAMA_BASE_URL = os.environ["OLLAMA_BASE_URL"]
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
LLM_MODEL = "llama3.1:8b"

# Inference tuning. The defaults below keep the model resident in memory and
# bound the work per request so responses don't take minutes on local hardware.
#   - KEEP_ALIVE: how long Ollama keeps the model loaded after a request.
#     "30m" avoids the multi-second cold reload (a 5GB+ model reload costs
#     ~6s every time it has been idle past the default 5 minutes). Use "-1"
#     to keep it loaded forever, or "0" to unload immediately.
#   - NUM_CTX: context window. Larger = more document context but more RAM and
#     slower prompt processing.
#   - NUM_PREDICT: hard cap on generated tokens. Critical for reasoning models
#     (e.g. deepseek-r1) whose <think> chains can otherwise run for thousands
#     of tokens. -1 means unlimited.
OLLAMA_KEEP_ALIVE = os.environ.get("OLLAMA_KEEP_ALIVE", "30m")
NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "4096"))
NUM_PREDICT = int(os.environ.get("OLLAMA_NUM_PREDICT", "1024"))
TEMPERATURE = float(os.environ.get("OLLAMA_TEMPERATURE", "0.7"))

# Chunking (nomic-embed-text supports ~2K tokens; ~1000 chars is safe)
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Retrieval
TOP_K = 4
PERSIST_DIRECTORY = "./vector_db"

# PostgreSQL (set DATABASE_URL or leave empty to disable logging)
DATABASE_URL = os.environ.get("DATABASE_URL", "")
