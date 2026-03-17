"""Streamlit UI for the offline document chatbot."""

import gc
import shutil
import tempfile
import uuid
from pathlib import Path

import streamlit as st

from config import OLLAMA_BASE_URL, PERSIST_DIRECTORY
from document_loader import DocumentProcessor
from query_history import (
    add_message as db_add_message,
    create_conversation as db_create_conversation,
    delete_conversation as db_delete_conversation,
    delete_message as db_delete_message,
    ensure_messages_table,
    ensure_conversations_schema,
    get_all_messages as db_get_all_messages,
    get_messages_for_conversation as db_get_messages_for_conversation,
    list_conversations as db_list_conversations,
    init_db as ensure_query_history_table,
    log_query as log_query_to_db,
)
from rag_chain import answer_question
from vector_store import VectorStoreManager

st.set_page_config(page_title="Document Chatbot", page_icon="📚", layout="centered")

# Hide Streamlit's "Deploy this app" footer and deploy button
st.markdown(
    """
    <style>
    .stDeployButton { display: none !important; }
    footer { visibility: hidden !important; }
    footer:after { content: ''; display: block; height: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("📚 Offline Document Chatbot")
st.caption("Upload documents, then ask questions. Answers are based only on your uploaded content. Runs fully offline with Ollama.")

# Session state: vector store and retriever after first ingest
if "vector_store" not in st.session_state:
    st.session_state.vector_store = None
if "retriever" not in st.session_state:
    st.session_state.retriever = None
if "messages" not in st.session_state:
    st.session_state.messages = []
if "current_conversation_id" not in st.session_state:
    st.session_state.current_conversation_id = None

ensure_query_history_table()
ensure_messages_table()
ensure_conversations_schema()

# After a page refresh, repopulate: ensure we have a current conversation and load its messages
if st.session_state.current_conversation_id is None:
    convos = db_list_conversations()
    if convos:
        st.session_state.current_conversation_id = convos[0]["id"]
        st.session_state.messages = db_get_messages_for_conversation(convos[0]["id"])
    else:
        new_id = db_create_conversation("Default")
        if new_id:
            st.session_state.current_conversation_id = new_id
        st.session_state.messages = []
elif not st.session_state.messages and st.session_state.current_conversation_id:
    st.session_state.messages = db_get_messages_for_conversation(st.session_state.current_conversation_id)


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
    if st.session_state.current_conversation_id:
        st.session_state.messages = db_get_messages_for_conversation(st.session_state.current_conversation_id)
    else:
        st.session_state.messages = []
    st.success(f"Processed {len(chunks)} chunks from your documents. You can ask questions below.")


# Sidebar: multiple chats (scrollable list) + clear documents
with st.sidebar:
    st.subheader("Chats")
    if st.button("➕ New chat", key="new_chat", use_container_width=True):
        new_id = db_create_conversation()
        if new_id is not None:
            st.session_state.current_conversation_id = new_id
            st.session_state.messages = []
            # Clear documents so upload section appears again for this new chat
            st.session_state.vector_store = None
            st.session_state.retriever = None
            persist_path = Path(PERSIST_DIRECTORY)
            if persist_path.exists():
                try:
                    shutil.rmtree(persist_path)
                except OSError:
                    pass
            st.rerun()
    st.markdown("---")
    convos = db_list_conversations()
    if convos:
        for c in convos:
            label = c["title"] or f"Chat {c['id']}"
            row1, row2 = st.columns([5, 1])
            with row1:
                if st.button(
                    label,
                    key=f"conv_{c['id']}",
                    use_container_width=True,
                    type="primary" if c["id"] == st.session_state.current_conversation_id else "secondary",
                ):
                    if c["id"] != st.session_state.current_conversation_id:
                        st.session_state.current_conversation_id = c["id"]
                        st.session_state.messages = db_get_messages_for_conversation(c["id"])
                        st.rerun()
            with row2:
                if st.button("🗑", key=f"del_conv_{c['id']}", help="Remove this chat"):
                    if db_delete_conversation(c["id"]):
                        if st.session_state.current_conversation_id == c["id"]:
                            remaining = [x for x in convos if x["id"] != c["id"]]
                            st.session_state.current_conversation_id = remaining[0]["id"] if remaining else None
                            st.session_state.messages = (
                                db_get_messages_for_conversation(remaining[0]["id"]) if remaining else []
                            )
                        st.rerun()
    else:
        st.caption("No chats yet. Start by asking a question below.")
    st.markdown("---")
    if st.session_state.retriever:
        st.success("Documents are ready.")
        if st.button("Clear documents and start over", key="sidebar_clear"):
            persist_path = Path(PERSIST_DIRECTORY)
            if persist_path.exists():
                try:
                    shutil.rmtree(persist_path)
                except OSError:
                    pass
            st.session_state.vector_store = None
            st.session_state.retriever = None
            st.rerun()


# Main area: chat (show history from DB even when retriever is lost after refresh)
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg.get("sources"):
            with st.expander("Sources"):
                for s in msg["sources"]:
                    st.caption(s)
        if msg.get("id") is not None:
            if st.button("Delete", key=f"del_{msg['id']}", type="secondary"):
                db_delete_message(msg["id"])
                if st.session_state.current_conversation_id:
                    st.session_state.messages = db_get_messages_for_conversation(st.session_state.current_conversation_id)
                else:
                    st.session_state.messages = db_get_all_messages()
                st.rerun()

# Upload and Process/Ingest: show only once per chat session (when no documents are loaded)
if not st.session_state.retriever:
    st.markdown("---")
    st.markdown("**Upload documents** (PDF, DOCX, TXT)")
    uploaded = st.file_uploader(
        "Choose files",
        type=["pdf", "docx", "doc", "txt"],
        accept_multiple_files=True,
        key="main_upload",
        label_visibility="collapsed",
    )
    col1, col2 = st.columns([3, 1])
    with col1:
        if uploaded:
            st.caption(f"Selected: {len(uploaded)} file(s) — then click **Process / Ingest**.")
    with col2:
        process_clicked = st.button("Process / Ingest", type="primary", key="main_ingest")
    if uploaded and process_clicked:
        with st.spinner("Loading and indexing documents…"):
            paths = []
            for f in uploaded:
                suffix = Path(f.name).suffix or ".txt"
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    tmp.write(f.read())
                    paths.append(tmp.name)
            try:
                ingest_files(paths)
                st.rerun()
            except Exception as e:
                err = str(e).lower()
                if "readonly" in err or "1032" in err or "read only" in err:
                    st.error(
                        "**Cannot write to the document database.** Restart the app and try **Process / Ingest** again."
                    )
                else:
                    st.error(f"Error: {e}")
            finally:
                for p in paths:
                    Path(p).unlink(missing_ok=True)
    st.info("Upload and process documents above, then the chat box will appear so you can ask questions.")
else:
    prompt = st.chat_input("Ask a question about your documents")
    if prompt:
        if st.session_state.current_conversation_id is None:
            new_id = db_create_conversation()
            if new_id:
                st.session_state.current_conversation_id = new_id
        user_id = db_add_message("user", prompt, conversation_id=st.session_state.current_conversation_id)
        st.session_state.messages.append({"id": user_id, "role": "user", "content": prompt})
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
                    assistant_id = db_add_message(
                        "assistant", answer, sources=sources, conversation_id=st.session_state.current_conversation_id
                    )
                    st.session_state.messages.append({
                        "id": assistant_id,
                        "role": "assistant",
                        "content": answer,
                        "sources": sources,
                    })
                    log_query_to_db(prompt)
                except Exception as e:
                    err = str(e)
                    if "connection" in err.lower() or "11434" in err:
                        st.error("Cannot reach Ollama. Is it running? Start it with: `ollama serve` or open the Ollama app.")
                    else:
                        st.error(f"Error: {err}")
