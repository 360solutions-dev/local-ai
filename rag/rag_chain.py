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
    Supports both Ollama and OpenAI-compatible providers.
    Returns (answer_text, list of source documents used).
    """
    if hasattr(retriever, "invoke"):
        docs = retriever.invoke(question)
    else:
        docs = retriever.get_relevant_documents(question)

    # Filter to a specific file if requested
    if file_filter:
        docs = [d for d in docs if d.metadata.get("filename") == file_filter][:top_k]

    context = _format_docs(docs)
    chain = build_rag_chain(base_url=base_url, model=model, provider_type=provider_type)
    answer = chain.invoke({"context": context, "question": question})
    return answer, docs
