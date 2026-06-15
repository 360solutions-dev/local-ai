/**
 * Next.js API route that proxies the streaming chat endpoint from Django.
 * The default `rewrites()` proxy buffers responses, which would defeat
 * token-by-token streaming — this route pipes the SSE body straight through.
 *
 * Auth: forwards the incoming `Cookie` header so Django's CookieJWTAuthentication
 * sees the user's access_token.
 */

const BACKEND_URL = process.env.BACKEND_URL!;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversation_id");

  if (!conversationId) {
    return Response.json({ error: "conversation_id required" }, { status: 400 });
  }

  const body = await request.text();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;

  const djangoResp = await fetch(
    `${BACKEND_URL}/api/chat/conversations/${conversationId}/messages/stream/`,
    { method: "POST", headers, body },
  );

  if (!djangoResp.ok || !djangoResp.body) {
    // Surface Django's JSON error (e.g. 401, 404) to the client unchanged.
    const text = await djangoResp.text().catch(() => "");
    return new Response(text || JSON.stringify({ error: "Upstream error" }), {
      status: djangoResp.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(djangoResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
