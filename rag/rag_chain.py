"""RAG chain: retrieve relevant chunks and generate answers with any provider."""

from typing import List, Tuple

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from config import (
    LLM_MODEL,
    NUM_CTX,
    NUM_PREDICT,
    OLLAMA_BASE_URL,
    OLLAMA_KEEP_ALIVE,
    TEMPERATURE,
    TOP_K,
)


SYSTEM_PROMPT = """You are a helpful assistant answering questions about documents the user has uploaded. The user's documents are provided to you in the Context section. Always treat the Context as the user's attached documents — never say "no attachment provided" or "please attach a file" when Context is non-empty. If the user asks for a summary or details of "the attachment" / "the document" / "this file", summarize the Context. If the answer to a specific question is not in the Context, say so clearly. Do not invent information beyond the Context."""

USER_TEMPLATE = """Context from the user's uploaded documents:

{context}

Question: {question}

Answer based only on the context above. The context above IS the user's attached document(s) — never claim no attachment was provided when context is present."""


# When the chat has no documents, behave like a normal conversational
# assistant (ChatGPT-style) instead of refusing with "the context does not
# contain an answer". Used whenever retrieval returns zero chunks.
CONVERSATIONAL_SYSTEM_PROMPT = """You are local-ai, a helpful, friendly AI assistant. Answer the user's questions naturally and conversationally using your own knowledge. Be concise and clear. If the user later attaches documents, you'll answer from those instead."""


def _format_docs(docs: List[Document]) -> str:
    return "\n\n---\n\n".join(doc.page_content for doc in docs)


def build_conversational_chain(
    base_url: str = OLLAMA_BASE_URL,
    model: str = LLM_MODEL,
    provider_type: str = "ollama",
):
    """Plain assistant chain (no document context) for no-files chats."""
    llm = _build_llm(base_url=base_url, model=model, provider_type=provider_type)
    prompt = ChatPromptTemplate.from_messages([
        ("system", CONVERSATIONAL_SYSTEM_PROMPT),
        ("human", "{question}"),
    ])
    return prompt | llm | StrOutputParser()


def _build_llm(base_url: str, model: str, provider_type: str = "ollama"):
    """Build a LangChain LLM for either Ollama or OpenAI-compatible providers."""
    if provider_type == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model,
            base_url=f"{base_url.rstrip('/')}/v1",
            api_key="not-needed",
            temperature=TEMPERATURE,
            max_tokens=NUM_PREDICT if NUM_PREDICT > 0 else None,
        )
    else:
        from langchain_ollama import ChatOllama

        # keep_alive keeps the model resident so we don't pay the cold reload
        # on every request; num_predict bounds reasoning models that would
        # otherwise generate for minutes.
        return ChatOllama(
            model=model,
            base_url=base_url,
            keep_alive=OLLAMA_KEEP_ALIVE,
            num_ctx=NUM_CTX,
            num_predict=NUM_PREDICT,
            temperature=TEMPERATURE,
        )


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


def retrieve_docs(
    question: str,
    retriever,
    top_k: int = TOP_K,
    file_filter: str | None = None,
) -> List[Document]:
    """
    Retrieve relevant chunks for a question.

    file_filter accepts either a single filename or a comma-separated list
    of filenames (used by Django to scope per-chat). When supplied, we use
    the underlying vector store's similarity_search with metadata filtering
    so that we get top_k *relevant chunks from the allowed files* — rather
    than retrieving top_k overall and post-filtering, which can return zero
    results when the dominant file in the index isn't in the allowed set.
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

            # fetch_k must span the WHOLE index, otherwise FAISS first takes the
            # globally-nearest fetch_k chunks and THEN filters by file — so a
            # file whose chunks rank beyond fetch_k (because a large file
            # dominates) gets ZERO hits and is silently dropped. Use the index
            # size so every allowed file's chunks are candidates.
            index_size = getattr(getattr(vs, "index", None), "ntotal", 0) or 100000
            fetch_k = max(500, index_size)

            if len(allowed) > 1:
                # Multiple files (default "all files" / @all): pull a few
                # relevant chunks PER file and merge, so every file is
                # represented. Otherwise one large file (many chunks) takes
                # all the top-k slots and the answer covers only that file.
                per_file = max(2, -(-top_k // len(allowed)))  # ceil(top_k / n)
                seen: set = set()
                for fname in sorted(allowed):
                    hits = vs.similarity_search(
                        question, k=per_file, fetch_k=fetch_k,
                        filter=lambda meta, _f=fname: meta.get("filename") == _f,
                    )
                    for d in hits:
                        key = (d.metadata.get("filename"), d.page_content[:80])
                        if key not in seen:
                            seen.add(key)
                            docs.append(d)
            else:
                docs = vs.similarity_search(
                    question, k=top_k, fetch_k=fetch_k, filter=_allowed,
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

    return docs


def answer_question(
    question: str,
    retriever,
    base_url: str = OLLAMA_BASE_URL,
    model: str = LLM_MODEL,
    provider_type: str = "ollama",
    top_k: int = TOP_K,
    file_filter: str | None = None,
) -> Tuple[str, List[Document]]:
    """Run RAG and return (answer_text, source documents) — blocking."""
    docs = retrieve_docs(question, retriever, top_k=top_k, file_filter=file_filter)
    if not docs:
        # No documents in this chat → answer conversationally (ChatGPT-style)
        # instead of "the context does not contain an answer".
        chain = build_conversational_chain(base_url=base_url, model=model, provider_type=provider_type)
        return chain.invoke({"question": question}), []
    context = _format_docs(docs)
    chain = build_rag_chain(base_url=base_url, model=model, provider_type=provider_type)
    answer = chain.invoke({"context": context, "question": question})
    return answer, docs


def answer_question_stream(
    question: str,
    retriever,
    base_url: str = OLLAMA_BASE_URL,
    model: str = LLM_MODEL,
    provider_type: str = "ollama",
    top_k: int = TOP_K,
    file_filter: str | None = None,
):
    """Run RAG and stream answer tokens.

    Yields (kind, value) tuples:
      ("sources", [filenames])  — emitted once, first
      ("token", "text chunk")   — emitted repeatedly as the LLM generates
    The caller is responsible for accumulating tokens into the final answer.
    """
    docs = retrieve_docs(question, retriever, top_k=top_k, file_filter=file_filter)
    sources = list(dict.fromkeys(
        d.metadata.get("filename", d.metadata.get("source", "unknown")) for d in docs
    ))
    yield ("sources", sources)

    if not docs:
        # No documents → conversational assistant (ChatGPT-style), not a
        # context-bound refusal.
        chain = build_conversational_chain(base_url=base_url, model=model, provider_type=provider_type)
        for chunk in chain.stream({"question": question}):
            if chunk:
                yield ("token", chunk)
        return

    context = _format_docs(docs)
    chain = build_rag_chain(base_url=base_url, model=model, provider_type=provider_type)
    for chunk in chain.stream({"context": context, "question": question}):
        if chunk:
            yield ("token", chunk)
