/**
 * Next.js API route that streams model pull progress from RAG service.
 * This bypasses the rewrite proxy which buffers entire responses.
 */

const RAG_URL = process.env.RAG_URL!;
const RAG_API_KEY = process.env.RAG_API_KEY || "";

// Where each Ollama engine lives (reachable from the RAG container), so the
// user can install a model on the host machine (GPU) or in Docker (CPU).
const OLLAMA_MACHINE_URL =
  process.env.OLLAMA_MACHINE_URL || "http://host.docker.internal:11434";
const OLLAMA_DOCKER_URL = process.env.OLLAMA_DOCKER_URL || "http://ollama:11434";

function resolveTarget(target: unknown): string | null {
  if (target === "machine") return OLLAMA_MACHINE_URL;
  if (target === "docker") return OLLAMA_DOCKER_URL;
  return null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = body.name;

  if (!name) {
    return Response.json({ error: "Model name required" }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (RAG_API_KEY) {
    headers["X-API-Key"] = RAG_API_KEY;
  }

  const baseUrl = resolveTarget(body.target);
  const ragResp = await fetch(`${RAG_URL}/api/models/pull`, {
    method: "POST",
    headers,
    body: JSON.stringify(baseUrl ? { name, base_url: baseUrl } : { name }),
  });

  if (!ragResp.ok || !ragResp.body) {
    return Response.json({ error: "RAG service error" }, { status: 502 });
  }

  // Pipe the stream directly to the client with no buffering
  return new Response(ragResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
