---
name: Bug report
about: Something broken? Tell us what happened so we can fix it.
title: "[Bug] "
labels: ["bug", "needs-triage"]
assignees: []
---

<!--
Before opening, please check:
- Existing issues: https://github.com/360solutions-dev/local-ai/issues?q=is%3Aissue
- Troubleshooting docs: https://docs.local-ai.run/troubleshooting
- Discord #install-help: https://discord.gg/vndd7TzhVU

Fill in every section. Issues missing reproduction steps or environment details
will be closed pending more information.
-->

## Summary

<!-- One-line description of the bug. What is broken? -->



## Steps to Reproduce

<!-- A precise, numbered list. Anyone reading should be able to follow these and hit the same bug. -->

1.
2.
3.

## Expected Behavior

<!-- What should have happened? -->



## Actual Behavior

<!-- What actually happened? Include exact error messages if any. -->



## Screenshots / Logs

<!--
Paste container logs:
  docker compose -f docker-compose.release.yml logs <service> --tail 50

Browser DevTools Network tab (Status, Response) for any failing API call.
For long logs, use a code block with triple backticks.
-->

```

```

## Environment

| Item | Value |
|---|---|
| **OS + version** | <!-- e.g., macOS 14.3 / Ubuntu 22.04 / Windows 11 + WSL2 --> |
| **Architecture** | <!-- arm64 (Apple Silicon) / amd64 (Intel) --> |
| **Docker Desktop / Engine version** | <!-- run: docker --version --> |
| **Docker Compose version** | <!-- run: docker compose version --> |
| **local-ai version** | <!-- Settings → Advanced → Version, or check LOCAL_AI_IMAGE_TAG in .env --> |
| **Install method** | <!-- curl one-liner / git clone + ./install.sh / docker-compose.release.yml --> |
| **Model engine** | <!-- Bundled Ollama (container-ollama profile) / Host Ollama / LM Studio / vLLM / other --> |
| **Chat model in use** | <!-- e.g., llama3.2:3b --> |
| **Embedding model in use** | <!-- e.g., mxbai-embed-large --> |
| **Browser + version** | <!-- e.g., Chrome 148 / Safari 17 / Firefox 121 --> |

## Container State

<!--
Run and paste output:
  docker compose -f docker-compose.release.yml ps
-->

```

```

## Anything Else

<!--
Recent changes, related issues, custom configuration, anything that might help us reproduce.
If this used to work and now doesn't, mention the last version where it worked.
-->



---

<!--
By submitting this issue you agree this report will be discussed publicly.
Please redact any secrets, API keys, or personally identifiable data from logs.
-->
