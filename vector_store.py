"""Vector store (FAISS) with Ollama embeddings for RAG."""

from pathlib import Path
from typing import List

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings

from config import (
    EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
    PERSIST_DIRECTORY,
    TOP_K,
)


class VectorStoreManager:
    """FAISS vector store with Ollama embeddings. Persists to disk via save_local."""

    def __init__(
        self,
        persist_directory: str = PERSIST_DIRECTORY,
        embedding_model: str = EMBEDDING_MODEL,
        base_url: str = OLLAMA_BASE_URL,
    ):
        Path(persist_directory).mkdir(parents=True, exist_ok=True)
        self.persist_directory = persist_directory
        self.embeddings = OllamaEmbeddings(
            model=embedding_model,
            base_url=base_url,
        )
        self._vector_store = None  # Set in add_documents

    def add_documents(self, documents: List[Document]) -> None:
        """Build FAISS index from documents and save to disk."""
        self._vector_store = FAISS.from_documents(documents, self.embeddings)
        self._vector_store.save_local(self.persist_directory)

    def get_retriever(self, k: int = TOP_K):
        """Return a retriever for RAG (top-k similarity search)."""
        if self._vector_store is None:
            raise RuntimeError("No documents loaded. Call add_documents first.")
        return self._vector_store.as_retriever(search_kwargs={"k": k})

    def similarity_search(self, query: str, k: int = TOP_K) -> List[Document]:
        """Search for relevant chunks by query."""
        if self._vector_store is None:
            raise RuntimeError("No documents loaded. Call add_documents first.")
        return self._vector_store.similarity_search(query, k=k)
