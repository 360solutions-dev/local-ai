FROM python:3.12-slim

WORKDIR /app

# ffmpeg is required by faster-whisper to decode webm/opus uploads from the browser.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so the first request doesn't pay the
# download cost. The model is cached under /models (mounted as a volume in
# docker-compose) so rebuilds don't re-download. ARG default matches the
# WHISPER_MODEL env var default below.
ARG WHISPER_MODEL=base
ENV WHISPER_MODEL_CACHE=/models
RUN python -c "from faster_whisper import WhisperModel; \
    WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8', download_root='${WHISPER_MODEL_CACHE}')"

COPY . .

EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
