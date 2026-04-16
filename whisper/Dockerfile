FROM python:3.12-slim

WORKDIR /app

# ffmpeg is required by faster-whisper to decode webm/opus uploads from the browser.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Models are downloaded on-demand via the /models/pull API, not at build time.
# The /models volume (mounted in docker-compose) persists downloads across restarts.
ENV WHISPER_MODEL_CACHE=/models

COPY . .

EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
