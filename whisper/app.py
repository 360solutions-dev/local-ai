"""Local offline speech-to-text service powered by faster-whisper.

Models are NOT downloaded automatically. Users pull models on-demand via the
/models/pull endpoint, and the active model is loaded lazily on the first
transcription request.

Endpoints
---------
GET  /health           – service + model status
GET  /models           – list downloaded models
POST /models/pull      – download a model by name
DELETE /models/{name}  – remove a downloaded model
POST /transcribe       – transcribe an audio file
"""

import json
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

import requests as dl_requests
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel
from huggingface_hub import HfApi

logger = logging.getLogger("whisper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
MODEL_CACHE = os.environ.get("WHISPER_MODEL_CACHE", "/models")
API_KEY = os.environ.get("WHISPER_API_KEY", "")
MAX_UPLOAD_BYTES = int(os.environ.get("WHISPER_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

# Recognised faster-whisper model sizes (Systran hub repos).
KNOWN_MODELS = [
    "tiny", "tiny.en",
    "base", "base.en",
    "small", "small.en",
    "medium", "medium.en",
    "large-v1", "large-v2", "large-v3",
]

# Fallback expected sizes (used until HF API returns real sizes).
_MODEL_EXPECTED_BYTES: dict[str, int] = {
    "tiny": 78_000_000, "tiny.en": 78_000_000,
    "base": 148_000_000, "base.en": 148_000_000,
    "small": 488_000_000, "small.en": 488_000_000,
    "medium": 1_530_000_000, "medium.en": 1_530_000_000,
    "large-v1": 3_100_000_000, "large-v2": 3_100_000_000, "large-v3": 3_100_000_000,
}

# Download chunk size: 1 MB gives ~100 progress updates for the base model.
_CHUNK_SIZE = 1 * 1024 * 1024

app = FastAPI(title="local-ai whisper", version="1.0.0")

# ---------------------------------------------------------------------------
# Model singleton – loaded lazily on first transcription, NOT on startup.
# ---------------------------------------------------------------------------
_model: WhisperModel | None = None
_active_model_name: str | None = None


def _model_dir(name: str) -> Path:
    """Simple flat directory for a downloaded model."""
    return Path(MODEL_CACHE) / name


def _is_downloaded(name: str) -> bool:
    d = _model_dir(name)
    # A .complete marker is written only after a fully successful download.
    return d.is_dir() and (d / ".complete").is_file() and (d / "model.bin").is_file()


def _dir_size_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def _list_downloaded() -> list[dict]:
    """Scan the cache directory and return info on every downloaded model."""
    models: list[dict] = []
    cache = Path(MODEL_CACHE)
    if not cache.is_dir():
        return models
    for name in KNOWN_MODELS:
        d = cache / name
        if d.is_dir() and (d / ".complete").is_file() and (d / "model.bin").is_file():
            size = _dir_size_bytes(d)
            models.append({"name": name, "size": size, "size_label": _fmt_size(size)})
    return models


def _fmt_size(b: int) -> str:
    if b < 1024:
        return f"{b} B"
    if b < 1024 ** 2:
        return f"{b / 1024:.1f} KB"
    if b < 1024 ** 3:
        return f"{b / 1024 ** 2:.1f} MB"
    return f"{b / 1024 ** 3:.2f} GB"


def get_model() -> WhisperModel:
    """Return the loaded model, or raise 503 if none is available."""
    global _model, _active_model_name
    if _model is not None:
        return _model

    # Try to load the preferred model (env default) if it's downloaded.
    target = _active_model_name or MODEL_NAME
    if _is_downloaded(target):
        logger.info("Loading whisper model name=%s compute_type=%s", target, COMPUTE_TYPE)
        _model = WhisperModel(str(_model_dir(target)), device="cpu", compute_type=COMPUTE_TYPE)
        _active_model_name = target
        logger.info("Whisper model ready")
        return _model

    # Fall back to any downloaded model.
    downloaded = _list_downloaded()
    if downloaded:
        fallback = downloaded[0]["name"]
        logger.info("Loading fallback whisper model name=%s", fallback)
        _model = WhisperModel(str(_model_dir(fallback)), device="cpu", compute_type=COMPUTE_TYPE)
        _active_model_name = fallback
        logger.info("Whisper model ready (fallback)")
        return _model

    raise HTTPException(status_code=503, detail="No whisper model installed. Pull a model first.")


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    downloaded = _list_downloaded()
    downloaded_names = {m["name"] for m in downloaded}
    # Report model name even before lazy-load so UI can show the badge.
    model_name = _active_model_name or ""
    if not model_name and downloaded:
        model_name = downloaded[0]["name"]
    # Available (not yet downloaded) models.
    available = [
        {"name": n}
        for n in _MODEL_EXPECTED_BYTES
        if n not in downloaded_names and not n.endswith(".en")
    ]
    return {
        "status": "ok",
        "model": model_name,
        "model_loaded": _model is not None,
        "has_model": len(downloaded) > 0,
        "models": downloaded,
        "available_models": available,
    }


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

@app.get("/models", dependencies=[Depends(require_api_key)])
def list_models() -> dict:
    return {"models": _list_downloaded()}


@app.post("/models/pull", dependencies=[Depends(require_api_key)])
async def pull_model(request: Request, body: dict | None = None):
    """Download a whisper model by name, streaming SSE progress events."""
    name = (body or {}).get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Missing 'name' field.")
    if name not in KNOWN_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model '{name}'. Available: {', '.join(KNOWN_MODELS)}",
        )
    if _is_downloaded(name):
        return {"status": "exists", "model": name}

    # Clean up any leftover partial download from a previous failed attempt.
    partial = _model_dir(name)
    if partial.is_dir() and not (partial / ".complete").is_file():
        shutil.rmtree(partial, ignore_errors=True)

    repo_id = f"Systran/faster-whisper-{name}"

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    def _stream():
        error_holder: list[str] = []
        done_event = threading.Event()
        cancel_event = threading.Event()

        # Thread-safe progress counters
        progress_lock = threading.Lock()
        progress_bytes = [0]
        progress_total = [_MODEL_EXPECTED_BYTES.get(name, 150_000_000)]

        def _do_download():
            try:
                # Get file list and real sizes from HuggingFace API
                api = HfApi()
                info = api.model_info(repo_id, files_metadata=True)
                files = [(s.rfilename, s.size or 0) for s in info.siblings]
                real_total = sum(size for _, size in files)
                if real_total > 0:
                    with progress_lock:
                        progress_total[0] = real_total

                dest = _model_dir(name)
                dest.mkdir(parents=True, exist_ok=True)

                for filename, _ in files:
                    if cancel_event.is_set():
                        raise InterruptedError("Download cancelled")

                    url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
                    file_path = dest / filename
                    file_path.parent.mkdir(parents=True, exist_ok=True)

                    resp = dl_requests.get(url, stream=True, timeout=600)
                    resp.raise_for_status()

                    with open(file_path, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=_CHUNK_SIZE):
                            if cancel_event.is_set():
                                resp.close()
                                raise InterruptedError("Download cancelled")
                            if chunk:
                                f.write(chunk)
                                with progress_lock:
                                    progress_bytes[0] += len(chunk)

                # Mark download as complete only after ALL files succeed.
                (dest / ".complete").write_text("ok")

            except Exception as e:
                # Clean up partial download
                dest = _model_dir(name)
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
                if not cancel_event.is_set():
                    error_holder.append(str(e))
            finally:
                done_event.set()

        thread = threading.Thread(target=_do_download, daemon=True)
        thread.start()

        try:
            yield _sse({"status": f"Pulling {name}...", "percent": 0})

            last_pct = -1
            while not done_event.is_set():
                time.sleep(0.3)
                with progress_lock:
                    current = progress_bytes[0]
                    total = progress_total[0]
                pct = min(int(current * 100 / total), 99) if total > 0 else 0
                if pct != last_pct:
                    last_pct = pct
                    yield _sse({
                        "status": f"Downloading {name} ({_fmt_size(current)} / {_fmt_size(total)})",
                        "percent": pct,
                    })

            thread.join()

            if error_holder:
                logger.error("Failed to pull model %s: %s", name, error_holder[0])
                yield _sse({"status": "error", "error": error_holder[0]})
                return

            logger.info("Successfully pulled model %s", name)

            global _model, _active_model_name
            _active_model_name = name
            _model = None
        except GeneratorExit:
            # Client disconnected (page reload / tab close) — cancel download
            logger.info("Client disconnected, cancelling download of %s", name)
            cancel_event.set()
            thread.join(timeout=5)
            return

        yield _sse({"status": "success", "percent": 100, "model": name})

    return StreamingResponse(_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.delete("/models/{name}", dependencies=[Depends(require_api_key)])
def delete_model(name: str) -> dict:
    d = _model_dir(name)
    if not d.is_dir():
        raise HTTPException(status_code=404, detail=f"Model '{name}' not found.")

    global _model, _active_model_name
    # If this is the active model, unload it.
    if _active_model_name == name:
        _model = None
        _active_model_name = None

    shutil.rmtree(d)
    logger.info("Deleted whisper model %s", name)
    return {"status": "ok", "model": name}


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

@app.post("/transcribe", dependencies=[Depends(require_api_key)])
async def transcribe(audio: UploadFile = File(...), language: str | None = None) -> dict:
    """Transcribe an uploaded audio file and return the recognized text."""
    started = time.perf_counter()

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="audio file too large")

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()

        model = get_model()
        segments, info = model.transcribe(
            tmp.name,
            language=language,
            vad_filter=True,
            beam_size=1,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "transcribed bytes=%d language=%s duration=%.2fs took=%dms",
        len(raw), info.language, info.duration, elapsed_ms,
    )
    return {
        "text": text,
        "language": info.language,
        "duration_ms": int(info.duration * 1000),
        "took_ms": elapsed_ms,
    }
