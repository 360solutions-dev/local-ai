"""Configuration for the offline document chatbot."""
import os

# Ollama
OLLAMA_BASE_URL = os.environ["OLLAMA_BASE_URL"]
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
LLM_MODEL = "llama3.1:8b"

# Chunking (nomic-embed-text supports ~2K tokens; ~1000 chars is safe)
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Retrieval
TOP_K = 4
PERSIST_DIRECTORY = "./vector_db"

# PostgreSQL (set DATABASE_URL or leave empty to disable logging)
DATABASE_URL = os.environ.get("DATABASE_URL", "")
