/**
 * Validates whether an Ollama model exists by checking ollama.com/library.
 * Falls back gracefully — if the library is unreachable, allows the pull to proceed.
 */

const OLLAMA_LIBRARY_URL = "https://ollama.com/library";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();

  if (!name) {
    return Response.json({ valid: false, error: "Model name is required" });
  }

  // Strip :tag if present — library pages are by base name
  const baseName = name.split(":")[0];

  try {
    const res = await fetch(`${OLLAMA_LIBRARY_URL}/${baseName}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      return Response.json({ valid: true });
    }

    if (res.status === 404) {
      return Response.json({
        valid: false,
        error: `Model "${baseName}" not found in Ollama library. Browse available models at ollama.com/library`,
      });
    }

    // Other status codes — allow pull to proceed
    return Response.json({ valid: true });
  } catch {
    // Library unreachable — allow pull, Ollama will report errors itself
    return Response.json({ valid: true });
  }
}
