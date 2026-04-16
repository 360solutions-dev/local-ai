/**
 * Next.js API route that streams whisper model pull progress from Django.
 * This bypasses the rewrite proxy which buffers entire responses.
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: Request) {
  const body = await request.json();
  const name = body.name;

  if (!name) {
    return Response.json({ error: "Model name required" }, { status: 400 });
  }

  // Forward cookies for authentication
  const cookie = request.headers.get("cookie") || "";

  const upstream = await fetch(
    `${BACKEND_URL}/api/system/services/whisper/models/pull/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ name }),
    }
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "Upstream error");
    return Response.json(
      { error: text },
      { status: upstream.status || 502 }
    );
  }

  // Pipe the SSE stream directly to the client with no buffering
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
