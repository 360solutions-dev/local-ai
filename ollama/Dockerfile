# Ollama with repo entrypoint baked in (no host-mounted ./ollama/entrypoint.sh).
FROM ollama/ollama:latest
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
