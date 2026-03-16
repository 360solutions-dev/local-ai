"""Vector store (ChromaDB) with Ollama embeddings for RAG."""

from pathlib import Path
from typing import List

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings

from config import (
    COLLECTION_NAME,
    EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
    PERSIST_DIRECTORY,
    TOP_K,
)


class VectorStoreManager:
    """ChromaDB vector store with Ollama embeddings. Persists to disk."""

    def __init__(
        self,
        persist_directory: str = PERSIST_DIRECTORY,
        collection_name: str = COLLECTION_NAME,
        embedding_model: str = EMBEDDING_MODEL,
        base_url: str = OLLAMA_BASE_URL,
    ):
        Path(persist_directory).mkdir(parents=True, exist_ok=True)
        self.embeddings = OllamaEmbeddings(
            model=embedding_model,
            base_url=base_url,
        )
        self._vector_store = Chroma(
            collection_name=collection_name,
            embedding_function=self.embeddings,
            persist_directory=persist_directory,
        )

    def add_documents(self, documents: List[Document]) -> None:
        """Add document chunks to the vector store. Persists automatically."""
        self._vector_store.add_documents(documents)

    def get_retriever(self, k: int = TOP_K):
        """Return a retriever for RAG (top-k similarity search)."""
        return self._vector_store.as_retriever(search_kwargs={"k": k})

    def similarity_search(self, query: str, k: int = TOP_K) -> List[Document]:
        """Search for relevant chunks by query."""
        return self._vector_store.similarity_search(query, k=k)
