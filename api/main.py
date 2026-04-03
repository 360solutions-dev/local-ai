"""FastAPI REST layer for local-ai: health, CORS, future RAG + DB routes."""

import os
import sys
from pathlib import Path

# Repo root (parent of api/)
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="local-ai API", version="0.1.0")

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_origins_list = [o.strip() for o in _origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ollama_reachable() -> bool:
    try:
        import urllib.request

        from config import OLLAMA_BASE_URL

        url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        with urllib.request.urlopen(url, timeout=2) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _db_reachable() -> bool:
    try:
        from config import DATABASE_URL

        if not DATABASE_URL:
            return False
        import psycopg2

        conn = psycopg2.connect(DATABASE_URL, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@app.get("/api/health")
def health():
    """Liveness + dependency checks for dashboard / ops."""
    ollama_ok = _ollama_reachable()
    db_ok = _db_reachable()
    return {
        "status": "ok" if (ollama_ok and db_ok) else "degraded",
        "ollama": ollama_ok,
        "database": db_ok,
    }


@app.get("/api/health/live")
def health_live():
    return {"status": "ok"}
