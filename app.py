"""Streamlit UI for the offline document chatbot."""

import gc
import shutil
import tempfile
import uuid
from pathlib import Path

import streamlit as st

from config import OLLAMA_BASE_URL, PERSIST_DIRECTORY
from document_loader import DocumentProcessor
from rag_chain import answer_question
from vector_store import VectorStoreManager

st.set_page_config(page_title="Document Chatbot", page_icon="📚", layout="centered")

st.title("📚 Offline Document Chatbot")
st.caption("Upload documents, then ask questions. Answers are based only on your uploaded content. Runs fully offline with Ollama.")

# Session state: vector store and retriever after first ingest
if "vector_store" not in st.session_state:
    st.session_state.vector_store = None
if "retriever" not in st.session_state:
    st.session_state.retriever = None
if "messages" not in st.session_state:
    st.session_state.messages = []


def ingest_files(file_paths: list[str]) -> None:
    """Load, chunk, embed, and store documents. Set vector_store and retriever in session state.
    Uses a new DB directory per ingest so the second (and later) uploads never hit a readonly DB.
    """
    processor = DocumentProcessor()
    chunks = processor.process_documents(file_paths)
    if not chunks:
        st.error("No content could be extracted from the selected files.")
        return
    # Release previous connection so the old DB is not held open (avoids 1032 readonly on second ingest)
    st.session_state.vector_store = None
    st.session_state.retriever = None
    gc.collect()
    # Use a new directory per ingest so we never write to the same DB file twice in one session
    persist_dir = str(Path(PERSIST_DIRECTORY) / f"run_{uuid.uuid4().hex[:12]}")
    vs = VectorStoreManager(persist_directory=persist_dir)
    vs.add_documents(chunks)
    st.session_state.vector_store = vs
    st.session_state.retriever = vs.get_retriever()
    st.session_state.messages = []
    st.success(f"Processed {len(chunks)} chunks from your documents. You can ask questions below.")


# Sidebar: upload and ingest
with st.sidebar:
    st.header("Upload documents")
    st.markdown("**Step 1:** Choose files (PDF, DOCX, or TXT)")
    uploaded = st.file_uploader(
        "Choose files",
        type=["pdf", "docx", "doc", "txt"],
        accept_multiple_files=True,
    )
    if uploaded:
        st.caption(f"Selected: {len(uploaded)} file(s)")
        st.markdown("**Step 2:** Click below to process and index them.")
        if st.button("Process / Ingest", type="primary"):
            with st.spinner("Loading and indexing documents…"):
                paths = []
                for f in uploaded:
                    suffix = Path(f.name).suffix or ".txt"
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                        tmp.write(f.read())
                        paths.append(tmp.name)
                try:
                    ingest_files(paths)
                except Exception as e:
                    err = str(e).lower()
                    if "readonly" in err or "1032" in err or "read only" in err:
                        st.error(
                            "**Cannot write to the document database.**\n\n"
                            "The app has applied a fix for the second-upload issue. If you still see this, "
                            "restart the app (stop and run `streamlit run app.py` again), then try **Process / Ingest** once more."
                        )
                    else:
                        st.error(f"Error: {e}")
                finally:
                    for p in paths:
                        Path(p).unlink(missing_ok=True)

    if st.session_state.retriever:
        st.success("Documents are ready. Use the chat below.")
        if st.button("Clear documents and start over"):
            persist_path = Path(PERSIST_DIRECTORY)
            if persist_path.exists():
                try:
                    shutil.rmtree(persist_path)
                except OSError:
                    pass
            st.session_state.vector_store = None
            st.session_state.retriever = None
            st.session_state.messages = []
            st.rerun()
    else:
        st.info("Upload and process documents first, then ask questions in the chat.")


# Main area: chat
if not st.session_state.retriever:
    st.info("👆 Upload and process documents in the sidebar to start asking questions.")
    with st.expander("How to start", expanded=True):
        st.markdown("""
        1. **In the sidebar:** Click **Browse files** or drag and drop your PDF, DOCX, or TXT files.
        2. After files appear, click the blue **Process / Ingest** button.
        3. When you see "Documents are ready", the chat box will appear here — type your question and press Enter.
        """)
else:
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            if msg.get("sources"):
                with st.expander("Sources"):
                    for s in msg["sources"]:
                        st.caption(s)

    if prompt := st.chat_input("Ask a question about your documents"):
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.chat_message("assistant"):
            with st.spinner("Thinking…"):
                try:
                    answer, docs = answer_question(
                        prompt,
                        st.session_state.retriever,
                        base_url=OLLAMA_BASE_URL,
                    )
                    st.markdown(answer)
                    sources = []
                    for d in docs:
                        src = d.metadata.get("filename", d.metadata.get("source", "—"))
                        if src not in sources:
                            sources.append(src)
                    if sources:
                        with st.expander("Sources"):
                            for s in sources:
                                st.caption(s)
                    st.session_state.messages.append({
                        "role": "assistant",
                        "content": answer,
                        "sources": sources,
                    })
                except Exception as e:
                    err = str(e)
                    if "connection" in err.lower() or "11434" in err:
                        st.error("Cannot reach Ollama. Is it running? Start it with: `ollama serve` or open the Ollama app.")
                    else:
                        st.error(f"Error: {err}")
