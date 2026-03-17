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

# PostgreSQL: query history (set DATABASE_URL or leave empty to disable logging)
# On macOS/Homebrew PostgreSQL the default role is usually your Mac username, not "postgres"
DATABASE_URL = "postgresql://muhammad:admin@localhost:5432/llm-ops-backend"
