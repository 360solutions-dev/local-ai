"""Streamlit UI for the offline document chatbot."""

import gc
import shutil
import tempfile
import uuid
from pathlib import Path

import streamlit as st

from config import DATABASE_URL, OLLAMA_BASE_URL, PERSIST_DIRECTORY
from document_loader import DocumentProcessor
from query_history import (
    add_message as db_add_message,
    create_conversation as db_create_conversation,
    delete_conversation as db_delete_conversation,
    delete_message as db_delete_message,
    delete_turn as db_delete_turn,
    ensure_messages_table,
    ensure_conversations_schema,
    get_all_messages as db_get_all_messages,
    get_messages_for_conversation as db_get_messages_for_conversation,
    list_conversations as db_list_conversations,
    init_db as ensure_query_history_table,
    log_query as log_query_to_db,
    maybe_update_conversation_title_from_first_user_message as db_set_title_from_first_message,
)
from rag_chain import answer_question
from vector_store import VectorStoreManager

st.set_page_config(page_title="Document Chat", page_icon="◆", layout="wide", initial_sidebar_state="expanded")

# Presentation-ready UI: typography, spacing, chat cards, subtle controls
st.markdown(
    """
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet">
    <style>
    .stDeployButton, footer { display: none !important; }
    html, body, [class*="css"] { font-family: 'DM Sans', system-ui, sans-serif !important; }
    .stApp { background: linear-gradient(165deg, #0c0f14 0%, #0e1219 45%, #0a0d12 100%); }
    /* ChatGPT-style sidebar: dark rail, dense chat list */
    section[data-testid="stSidebar"] {
        background: #171717 !important;
        border-right: 1px solid rgba(255,255,255,0.08) !important;
        width: 280px !important;
        min-width: 260px !important;
    }
    section[data-testid="stSidebar"] > div {
        padding-top: 0.35rem;
    }
    .sb-brand {
        font-size: 1.05rem;
        font-weight: 600;
        color: #ececec;
        letter-spacing: -0.02em;
        margin: 0 0 0.15rem 0;
        padding: 0.35rem 0.5rem 0.85rem;
        border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .sb-section-label {
        font-size: 0.72rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #8e8e8e;
        margin: 0.85rem 0 0.4rem 0.35rem;
    }
    section[data-testid="stSidebar"] button[kind="primary"] {
        background: #ececec !important;
        color: #171717 !important;
        border: none !important;
        border-radius: 10px !important;
        font-weight: 600 !important;
        padding: 0.55rem 0.85rem !important;
        min-height: 2.65rem !important;
        box-shadow: none !important;
    }
    section[data-testid="stSidebar"] button[kind="primary"]:hover {
        background: #f4f4f4 !important;
    }
    section[data-testid="stSidebar"] button[kind="secondary"] {
        background: transparent !important;
        color: #ececec !important;
        border: 1px solid transparent !important;
        border-radius: 10px !important;
        justify-content: flex-start !important;
        text-align: left !important;
        font-weight: 400 !important;
        padding: 0.45rem 0.65rem !important;
        min-height: 2.35rem !important;
        box-shadow: none !important;
    }
    section[data-testid="stSidebar"] button[kind="secondary"]:hover {
        background: rgba(255,255,255,0.06) !important;
    }
    section[data-testid="stSidebar"] .stHorizontalBlock {
        gap: 0.25rem !important;
        align-items: stretch !important;
    }
    section[data-testid="stSidebar"] [data-testid="column"]:last-child button {
        min-width: 2rem !important;
        width: 2rem !important;
        padding: 0 !important;
        opacity: 0.55;
        border-radius: 8px !important;
    }
    section[data-testid="stSidebar"] [data-testid="column"]:last-child button:hover {
        opacity: 1;
        background: rgba(239,68,68,0.12) !important;
    }
    .sb-footer {
        margin-top: 1rem;
        padding-top: 0.85rem;
        border-top: 1px solid rgba(255,255,255,0.08);
    }
    [data-testid="stSidebar"] .stMarkdown h2, [data-testid="stSidebar"] h3 {
        font-size: 0.7rem !important;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #8b92a8 !important;
        font-weight: 600 !important;
        margin-bottom: 0.75rem !important;
    }
    .app-hero {
        background: linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(15,23,42,0.4) 50%, rgba(59,130,246,0.06) 100%);
        border: 1px solid rgba(59,130,246,0.2);
        border-radius: 16px;
        padding: 1.5rem 1.75rem 1.35rem;
        margin-bottom: 1.5rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25);
    }
    .app-hero h1 {
        font-size: 1.65rem !important;
        font-weight: 700 !important;
        letter-spacing: -0.02em;
        margin: 0 0 0.35rem 0 !important;
        color: #f1f5f9 !important;
        border: none !important;
    }
    .app-hero .tagline { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0; }
    .app-hero .badges { margin-top: 0.85rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .app-hero .badge {
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        background: rgba(59,130,246,0.15);
        color: #93c5fd;
        border: 1px solid rgba(59,130,246,0.25);
    }
    .upload-panel {
        background: rgba(21,25,34,0.85);
        border: 1px dashed rgba(148,163,184,0.25);
        border-radius: 14px;
        padding: 1.25rem 1.35rem 1.1rem;
        margin: 1rem 0 0.75rem;
    }
    .upload-panel h3 { font-size: 1rem !important; margin: 0 0 0.5rem !important; color: #e2e8f0 !important; }
    div[data-testid="stChatMessage"] {
        background: rgba(21,25,34,0.55) !important;
        border: 1px solid rgba(255,255,255,0.06) !important;
        border-radius: 14px !important;
        padding: 0.85rem 1rem 0.65rem !important;
        margin-bottom: 0.65rem !important;
    }
    div[data-testid="stChatMessage"] [data-testid="stChatMessageAvatar"] {
        background: linear-gradient(145deg, #3b82f6, #2563eb) !important;
    }
    div[data-testid="stChatMessage"] [data-testid="stChatMessageAvatarUser"] {
        background: linear-gradient(145deg, #475569, #334155) !important;
    }
    div[data-testid="column"] { min-width: 0 !important; }
    .stAlert[data-baseweb="notification"] { border-radius: 12px !important; }
    /* Trash for Q&A turn: outside message cards, compact icon (help → title in Streamlit) */
    button[title="Remove this question and answer"] {
        min-width: 2.25rem !important;
        width: 2.25rem !important;
        height: 2.25rem !important;
        padding: 0 !important;
        border-radius: 8px !important;
        background: rgba(30,41,59,0.55) !important;
        border: 1px solid rgba(148,163,184,0.12) !important;
        font-size: 1rem !important;
        line-height: 1 !important;
        box-shadow: none !important;
        align-self: flex-start;
        margin-top: 0.25rem;
    }
    button[title="Remove this question and answer"]:hover {
        background: rgba(239,68,68,0.12) !important;
        border-color: rgba(239,68,68,0.35) !important;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div class="app-hero">
        <h1>Document Chat</h1>
        <p class="tagline">Ask questions grounded in your files. Answers use only your uploaded content—fully private, powered by Ollama on your machine.</p>
        <div class="badges">
            <span class="badge">Private RAG</span>
            <span class="badge">Offline-ready</span>
            <span class="badge">PDF · DOCX · TXT</span>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

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


def _valid_conversation_ids() -> set[int]:
    return {c["id"] for c in db_list_conversations()}


def _sync_conversation_query_param() -> None:
    """Persist active thread in the URL so reload restores the same conversation + messages."""
    cid = st.session_state.current_conversation_id
    try:
        if cid is None:
            if "c" in st.query_params:
                del st.query_params["c"]
            return
        cur = st.query_params.get("c")
        cur_s = str(cur[0] if isinstance(cur, list) else cur) if cur is not None else None
        if cur_s != str(cid):
            st.query_params["c"] = str(cid)
    except Exception:
        pass


# Restore the correct thread after reload (Streamlit session resets; DB + ?c= is source of truth)
if DATABASE_URL:
    raw_c = st.query_params.get("c")
    if raw_c is not None:
        try:
            url_cid = int(raw_c[0] if isinstance(raw_c, list) else raw_c)
            if url_cid in _valid_conversation_ids():
                st.session_state.current_conversation_id = url_cid
        except (TypeError, ValueError):
            pass
    if st.session_state.current_conversation_id is None:
        convos = db_list_conversations()
        if convos:
            st.session_state.current_conversation_id = convos[0]["id"]
        else:
            new_id = db_create_conversation("Default")
            if new_id:
                st.session_state.current_conversation_id = new_id
    if st.session_state.current_conversation_id is not None:
        st.session_state.messages = db_get_messages_for_conversation(
            st.session_state.current_conversation_id
        )
    else:
        st.session_state.messages = []
    _sync_conversation_query_param()
else:
    if st.session_state.current_conversation_id is None:
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
    if st.session_state.current_conversation_id:
        st.session_state.messages = db_get_messages_for_conversation(st.session_state.current_conversation_id)
    else:
        st.session_state.messages = []
    st.success(f"Processed {len(chunks)} chunks from your documents. You can ask questions below.")


def _group_messages_into_turns(messages: list[dict]) -> list[dict]:
    """Group consecutive user→assistant rows that belong to the same Q&A turn."""
    turns: list[dict] = []
    i = 0
    n = len(messages)
    while i < n:
        m = messages[i]
        if m["role"] == "assistant":
            turns.append({"messages": [m], "turn_id": m.get("turn_id")})
            i += 1
            continue
        u = m
        utid = u.get("turn_id")
        if i + 1 < n and messages[i + 1]["role"] == "assistant":
            a = messages[i + 1]
            atid = a.get("turn_id")
            same_turn = (utid is not None and atid is not None and utid == atid) or (
                utid is None and atid is None
            )
            if same_turn:
                turns.append({"messages": [u, a], "turn_id": utid})
                i += 2
                continue
        turns.append({"messages": [u], "turn_id": utid})
        i += 1
    return turns


def _reload_messages_after_delete() -> None:
    if st.session_state.current_conversation_id:
        st.session_state.messages = db_get_messages_for_conversation(
            st.session_state.current_conversation_id
        )
    else:
        st.session_state.messages = db_get_all_messages()


def render_turn(turn: dict) -> None:
    """Render one turn: user + optional assistant, single trash control outside the cards (top-right)."""
    msgs = turn["messages"]
    tid = turn.get("turn_id")
    # Stable button key: UUID turn, or legacy pair ids
    if tid:
        btn_key = f"delturn_{tid}"
    elif len(msgs) == 2 and msgs[0].get("id") and msgs[1].get("id"):
        btn_key = f"delpair_{msgs[0]['id']}_{msgs[1]['id']}"
    elif msgs[0].get("id"):
        btn_key = f"delsingle_{msgs[0]['id']}"
    else:
        btn_key = None

    msg_col, del_col = st.columns([1, 0.07])
    with msg_col:
        for msg in msgs:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])
                if msg.get("sources"):
                    with st.expander("Sources", expanded=False):
                        for s in msg["sources"]:
                            st.caption(s)

    with del_col:
        if btn_key and st.session_state.current_conversation_id is not None:
            if st.button(
                "🗑",
                key=btn_key,
                help="Remove this question and answer",
                type="secondary",
            ):
                cid = st.session_state.current_conversation_id
                if tid:
                    db_delete_turn(cid, tid)
                else:
                    for m in msgs:
                        if m.get("id") is not None:
                            db_delete_message(m["id"])
                _reload_messages_after_delete()
                st.rerun()


def _sidebar_chat_title(title: str | None, max_len: int = 34) -> str:
    """Short label like ChatGPT (truncated title / New chat)."""
    t = (title or "").strip() or "New chat"
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


# Sidebar: ChatGPT-style rail (brand, New chat, scrollable history, footer)
with st.sidebar:
    st.markdown('<p class="sb-brand">Document Chat</p>', unsafe_allow_html=True)
    if st.button("+ New chat", key="new_chat", use_container_width=True, type="primary"):
        new_id = db_create_conversation()
        if new_id is not None:
            st.session_state.current_conversation_id = new_id
            st.session_state.messages = []
            st.session_state.vector_store = None
            st.session_state.retriever = None
            persist_path = Path(PERSIST_DIRECTORY)
            if persist_path.exists():
                try:
                    shutil.rmtree(persist_path)
                except OSError:
                    pass
            if DATABASE_URL:
                st.query_params["c"] = str(new_id)
            st.rerun()

    st.markdown('<p class="sb-section-label">Your chats</p>', unsafe_allow_html=True)
    convos = db_list_conversations()
    if convos:
        for c in convos:
            is_active = c["id"] == st.session_state.current_conversation_id
            label = _sidebar_chat_title(c.get("title"))
            if is_active:
                label = f"●  {label}"
            row1, row2 = st.columns([5, 1])
            with row1:
                if st.button(
                    label,
                    key=f"conv_{c['id']}",
                    use_container_width=True,
                    type="secondary",
                ):
                    if c["id"] != st.session_state.current_conversation_id:
                        st.session_state.current_conversation_id = c["id"]
                        st.session_state.messages = db_get_messages_for_conversation(c["id"])
                        if DATABASE_URL:
                            st.query_params["c"] = str(c["id"])
                        st.rerun()
            with row2:
                if st.button("🗑", key=f"del_conv_{c['id']}", help="Delete chat"):
                    if db_delete_conversation(c["id"]):
                        if st.session_state.current_conversation_id == c["id"]:
                            remaining = [x for x in convos if x["id"] != c["id"]]
                            st.session_state.current_conversation_id = remaining[0]["id"] if remaining else None
                            st.session_state.messages = (
                                db_get_messages_for_conversation(remaining[0]["id"]) if remaining else []
                            )
                            if DATABASE_URL:
                                if remaining:
                                    st.query_params["c"] = str(remaining[0]["id"])
                                elif "c" in st.query_params:
                                    del st.query_params["c"]
                        st.rerun()
    else:
        st.caption("No chats yet — start a new chat or index documents.")

    st.markdown('<div class="sb-footer">', unsafe_allow_html=True)
    if st.session_state.retriever:
        st.markdown(
            '<p style="margin:0 0 0.5rem;"><span style="background:rgba(34,197,94,0.12);color:#86efac;padding:0.3rem 0.55rem;border-radius:6px;font-size:0.75rem;font-weight:600;">Documents indexed</span></p>',
            unsafe_allow_html=True,
        )
        if st.button("Clear documents", key="sidebar_clear", use_container_width=True, type="secondary"):
            persist_path = Path(PERSIST_DIRECTORY)
            if persist_path.exists():
                try:
                    shutil.rmtree(persist_path)
                except OSError:
                    pass
            st.session_state.vector_store = None
            st.session_state.retriever = None
            st.rerun()
    st.caption("Local · Ollama · Private RAG")
    st.markdown("</div>", unsafe_allow_html=True)


# Main chat column (narrower content reads more like a product UI)
main_col, _pad = st.columns([1.15, 0.25])
with main_col:
    st.markdown(
        '<p style="color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.75rem;">Thread</p>',
        unsafe_allow_html=True,
    )
    for turn in _group_messages_into_turns(st.session_state.messages):
        render_turn(turn)

    # Upload / index: once per chat session until documents are loaded
    if not st.session_state.retriever:
        st.markdown("---")
        with st.container(border=True):
            st.markdown("**Ingest documents**")
            st.caption("PDF, Word, or plain text — up to 200 MB per file.")
            uploaded = st.file_uploader(
                "Drop files here or browse",
                type=["pdf", "docx", "doc", "txt"],
                accept_multiple_files=True,
                key="main_upload",
                label_visibility="visible",
            )
            col1, col2 = st.columns([3, 1])
            with col1:
                if uploaded:
                    st.caption(f"{len(uploaded)} file(s) selected — run **Index** when ready.")
            with col2:
                process_clicked = st.button("Index & load", type="primary", key="main_ingest", use_container_width=True)
        if uploaded and process_clicked:
            with st.spinner("Indexing your documents…"):
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
                            "**Cannot write to the vector index.** Restart the app and try **Index & load** again."
                        )
                    else:
                        st.error(f"Error: {e}")
                finally:
                    for p in paths:
                        Path(p).unlink(missing_ok=True)
        st.info("Index your files above, then use the composer to ask questions.")

    else:
        # ChatGPT-style order: (1) prior turns query→reply, (2) generating reply if any,
        # (3) chat composer last. Avoid rendering chat_input before new messages (Streamlit order).
        pending = st.session_state.get("_pending_llm")
        if pending and st.session_state.retriever:
            with st.chat_message("assistant"):
                with st.spinner("Generating answer…"):
                    try:
                        answer, docs = answer_question(
                            pending["prompt"],
                            st.session_state.retriever,
                            base_url=OLLAMA_BASE_URL,
                        )
                        sources = []
                        for d in docs:
                            src = d.metadata.get("filename", d.metadata.get("source", "—"))
                            if src not in sources:
                                sources.append(src)
                        assistant_id, add_err = db_add_message(
                            "assistant",
                            answer,
                            sources=sources,
                            conversation_id=st.session_state.current_conversation_id,
                            turn_id=pending["turn_uid"],
                        )
                        if assistant_id is None:
                            del st.session_state["_pending_llm"]
                            st.error(add_err or "Could not save the response. Check your database.")
                        else:
                            log_query_to_db(pending["prompt"])
                            del st.session_state["_pending_llm"]
                            st.rerun()
                    except Exception as e:
                        del st.session_state["_pending_llm"]
                        err = str(e)
                        if "connection" in err.lower() or "11434" in err:
                            st.error(
                                "Cannot reach Ollama. Is it running? Start it with: `ollama serve` or open the Ollama app."
                            )
                        else:
                            st.error(f"Error: {err}")

        st.markdown('<div style="height:0.75rem"></div>', unsafe_allow_html=True)
        prompt = st.chat_input("Ask anything about your documents…")
        if prompt:
            if st.session_state.current_conversation_id is None:
                new_id = db_create_conversation()
                if new_id:
                    st.session_state.current_conversation_id = new_id
                    if DATABASE_URL:
                        st.query_params["c"] = str(new_id)
            turn_uid = str(uuid.uuid4())
            user_id, add_err = db_add_message(
                "user",
                prompt,
                conversation_id=st.session_state.current_conversation_id,
                turn_id=turn_uid,
            )
            if user_id is not None:
                if st.session_state.current_conversation_id is not None:
                    db_set_title_from_first_message(
                        st.session_state.current_conversation_id, prompt
                    )
                st.session_state["_pending_llm"] = {"prompt": prompt, "turn_uid": turn_uid}
                st.rerun()
            else:
                st.error(add_err or "Could not save your message. Check your database connection.")
