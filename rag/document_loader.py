"""Load and chunk documents (PDF, DOCX, TXT) for RAG."""

import os
from pathlib import Path
from typing import List

from langchain_community.document_loaders import (
    Docx2txtLoader,
    PyPDFLoader,
    TextLoader,
)
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import CHUNK_OVERLAP, CHUNK_SIZE


class DocumentProcessor:
    """Load documents by type and split into chunks for embedding."""

    def __init__(
        self,
        chunk_size: int = CHUNK_SIZE,
        chunk_overlap: int = CHUNK_OVERLAP,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", " ", ""],
        )

    def load_documents(self, file_path: str) -> List[Document]:
        """Load a single file into LangChain Documents by extension."""
        path = Path(file_path)
        suffix = path.suffix.lower()

        if suffix == ".pdf":
            loader = PyPDFLoader(file_path)
        elif suffix in (".docx", ".doc"):
            loader = Docx2txtLoader(file_path)
        elif suffix == ".txt":
            loader = TextLoader(file_path, encoding="utf-8", autodetect_encoding=True)
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

        return loader.load()

    def process_documents(self, file_paths: List[str]) -> List[Document]:
        """Load multiple files, add metadata, and split into chunks."""
        all_documents: List[Document] = []

        for file_path in file_paths:
            try:
                docs = self.load_documents(file_path)
                for doc in docs:
                    doc.metadata["source"] = file_path
                    doc.metadata["filename"] = os.path.basename(file_path)
                all_documents.extend(docs)
            except Exception as e:
                raise RuntimeError(f"Error processing {file_path}: {e}") from e

        chunks = self.text_splitter.split_documents(all_documents)
        return chunks
