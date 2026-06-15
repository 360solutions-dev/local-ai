#!/bin/sh

# Start Ollama server in the background
ollama serve &

# Wait for Ollama to be ready
echo "Waiting for Ollama server to start..."
until ollama list >/dev/null 2>&1; do
  sleep 1
done
echo "Ollama server is ready."


# Keep the server running in the foreground
wait
