#!/bin/sh

# Start Ollama server in the background
ollama serve &

# Wait for Ollama to be ready
echo "Waiting for Ollama server to start..."
until ollama list >/dev/null 2>&1; do
  sleep 1
done
echo "Ollama server is ready."

# Pull only the embedding model (required for RAG)
echo "Pulling nomic-embed-text (embedding model)..."
ollama pull nomic-embed-text

echo "Embedding model is ready. Pull your preferred LLM manually: ollama pull <model-name>"

# Keep the server running in the foreground
wait
