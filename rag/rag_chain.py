"""RAG chain: retrieve relevant chunks and generate answers with any provider."""

from typing import List, Tuple

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from config import LLM_MODEL, OLLAMA_BASE_URL, TOP_K


SYSTEM_PROMPT = """You are a helpful assistant. Answer questions using only the provided document context. If the answer cannot be found in the context, say so clearly. Do not invent information."""

USER_TEMPLATE = """Context from the documents:

{context}

Question: {question}

Answer based only on the context above:"""


def _format_docs(docs: List[Document]) -> str:
    return "\n\n---\n\n".join(doc.page_content for doc in docs)


def _build_llm(base_url: str, model: str, provider_type: str = "ollama"):
    """Build a LangChain LLM for either Ollama or OpenAI-compatible providers."""
    if provider_type == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model,
            base_url=f"{base_url.rstrip('/')}/v1",
            api_key="not-needed",
        )
    else:
        from langchain_ollama import ChatOllama

        return ChatOllama(model=model, base_url=base_url)


def build_rag_chain(
    base_url: str = OLLAMA_BASE_URL,
    model: str = LLM_MODEL,
    provider_type: str = "ollama",
):
    """Build a LangChain RAG chain (retriever + prompt + LLM)."""
    llm = _build_llm(base_url=base_url, model=model, provider_type=provider_type)
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", USER_TEMPLATE),
    ])
    return prompt | llm | StrOutputParser()


def answer_question(
    question: str,
    retriever,
    base_url: str = OLLAMA_BASE_URL,
    model: str = LLM_MODEL,
    provider_type: str = "ollama",
    top_k: int = TOP_K,
    file_filter: str | None = None,
) -> Tuple[str, List[Document]]:
    """
    Run RAG: retrieve relevant chunks, then generate an answer.

    file_filter accepts either a single filename or a comma-separated list
    of filenames (used by Django to scope per-chat). When supplied, we use
    the underlying vector store's similarity_search with metadata filtering
    so that we get top_k *relevant chunks from the allowed files* — rather
    than retrieving top_k overall and post-filtering, which can return zero
    results when the dominant file in the index isn't in the allowed set.

    Returns (answer_text, list of source documents used).
    """
    allowed: set[str] | None = None
    if file_filter:
        allowed = {n.strip() for n in file_filter.split(",") if n.strip()}

    docs: List[Document] = []
    if allowed:
        vs = getattr(retriever, "vectorstore", None)
        if vs is not None and hasattr(vs, "similarity_search"):
            # Vector-level filter so we get top-k *from the allowed files*,
            # not top-k overall then post-filter. langchain FAISS first
            # fetches `fetch_k` candidates by similarity then applies the
            # filter — fetch_k default is 20 which is FAR too small when
            # one document dominates the index. Use a large fetch_k so
            # the filter has enough candidates to find chunks from the
            # allowed files.
            def _allowed(meta: dict) -> bool:
                return meta.get("filename") in allowed

            # fetch_k must be large enough to include chunks from filtered
            # files even when one large file dominates the index, but not so
            # large that we scan the entire vector store unnecessarily.
            # 500 is a good balance for indexes up to ~5000 chunks.
            docs = vs.similarity_search(
                question, k=top_k, fetch_k=500, filter=_allowed,
            )
        else:
            # Fallback when retriever doesn't expose vectorstore
            raw = retriever.invoke(question) if hasattr(retriever, "invoke") else retriever.get_relevant_documents(question)
            docs = [d for d in raw if d.metadata.get("filename") in allowed][:top_k]
    else:
        docs = retriever.invoke(question) if hasattr(retriever, "invoke") else retriever.get_relevant_documents(question)

    context = _format_docs(docs)
    chain = build_rag_chain(base_url=base_url, model=model, provider_type=provider_type)
    answer = chain.invoke({"context": context, "question": question})
    return answer, docs
