"""Configuration for the offline document chatbot."""

# Ollama
OLLAMA_BASE_URL = "http://localhost:11434"
EMBEDDING_MODEL = "nomic-embed-text"
LLM_MODEL = "llama3.1:8b"

# Chunking (nomic-embed-text supports ~2K tokens; ~1000 chars is safe)
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Retrieval
TOP_K = 4
PERSIST_DIRECTORY = "./vector_db"
COLLECTION_NAME = "documents"
