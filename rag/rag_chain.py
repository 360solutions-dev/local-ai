"""RAG chain: retrieve relevant chunks and generate answers with any provider."""

from typing import List, Tuple

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from config import LLM_MODEL, OLLAMA_BASE_URL, TOP_K


SYSTEM_PROMPT = """You are a helpful assistant answering questions about documents the user has uploaded. The user's documents are provided to you in the Context section. Always treat the Context as the user's attached documents — never say "no attachment provided" or "please attach a file" when Context is non-empty. If the user asks for a summary or details of "the attachment" / "the document" / "this file", summarize the Context. If the answer to a specific question is not in the Context, say so clearly. Do not invent information beyond the Context."""

USER_TEMPLATE = """Context from the user's uploaded documents:

{context}

Question: {question}

Answer based only on the context above. The context above IS the user's attached document(s) — never claim no attachment was provided when context is present."""


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
            def _allowed(meta: dict) -> bool:
                return meta.get("filename") in allowed

            # fetch_k=500 gives the metadata filter enough candidates when
            # one file dominates the index.
            docs = vs.similarity_search(
                question, k=top_k, fetch_k=500, filter=_allowed,
            )

            # Meta-language queries like "describe this attachment" have
            # no semantic overlap with the file content, so similarity
            # returns nothing. When that happens but files ARE scoped to
            # this chat, fall back to the first chunks of the allowed
            # files so the model has real content to work with instead of
            # answering "I don't see an attachment".
            if not docs:
                docstore_dict = getattr(getattr(vs, "docstore", None), "_dict", {})
                for d in docstore_dict.values():
                    if d.metadata.get("filename") in allowed:
                        docs.append(d)
                        if len(docs) >= top_k:
                            break
        else:
            raw = retriever.invoke(question) if hasattr(retriever, "invoke") else retriever.get_relevant_documents(question)
            docs = [d for d in raw if d.metadata.get("filename") in allowed][:top_k]
    else:
        docs = retriever.invoke(question) if hasattr(retriever, "invoke") else retriever.get_relevant_documents(question)

    context = _format_docs(docs)
    chain = build_rag_chain(base_url=base_url, model=model, provider_type=provider_type)
    answer = chain.invoke({"context": context, "question": question})
    return answer, docs
