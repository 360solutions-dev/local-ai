"""Local offline speech-to-text service powered by faster-whisper.

This service exposes a single /transcribe endpoint that accepts an audio file
upload (webm/opus from the browser MediaRecorder, or any ffmpeg-decodable
format) and returns the transcribed text.

The whisper model is loaded once on startup and kept in memory so each request
only pays the inference cost (~1-2s for a 10s clip on Apple Silicon CPU with
the int8 base model).
"""

import logging
import os
import tempfile
import time

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

logger = logging.getLogger("whisper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
MODEL_CACHE = os.environ.get("WHISPER_MODEL_CACHE", "/models")
API_KEY = os.environ.get("WHISPER_API_KEY", "")
# Reject uploads larger than this to bound memory use. ~10 MB at 16kHz mono opus
# is roughly 10 minutes of speech, which is well past any chat-input use case.
MAX_UPLOAD_BYTES = int(os.environ.get("WHISPER_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

app = FastAPI(title="local-ai whisper", version="1.0.0")

# Lazy global so startup is fast and the model is only loaded once.
_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info("Loading whisper model name=%s compute_type=%s", MODEL_NAME, COMPUTE_TYPE)
        _model = WhisperModel(
            MODEL_NAME,
            device="cpu",
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_CACHE,
        )
        logger.info("Whisper model ready")
    return _model


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Match the same shared-secret pattern used by the RAG service."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")


@app.on_event("startup")
def _warm_model() -> None:
    # Eager-load so the first user request isn't the one that pays the load cost.
    get_model()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "model_loaded": _model is not None}


@app.post("/transcribe", dependencies=[Depends(require_api_key)])
async def transcribe(audio: UploadFile = File(...), language: str | None = None) -> dict:
    """Transcribe an uploaded audio file and return the recognized text."""
    started = time.perf_counter()

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="audio file too large")

    # faster-whisper reads from a path (it pipes the file through ffmpeg). Write
    # the upload to a temp file and let the OS clean it up when we're done.
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()

        model = get_model()
        # vad_filter trims silence which both speeds up inference and improves
        # quality on chat-style "tap to speak" recordings that include leading/
        # trailing silence.
        segments, info = model.transcribe(
            tmp.name,
            language=language,  # None = auto-detect
            vad_filter=True,
            beam_size=1,  # greedy is much faster on CPU and quality is fine for short utterances
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
