// Server-only adapter for the authoritative Supabase session lookup endpoint.
// The endpoint MUST be a trusted server-side service that queries auth.sessions,
// authenticates this Worker with a secret, and never trusts a browser-supplied result.
// Do not configure SESSION_LOOKUP_URL to a public client-accessible endpoint.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupabaseSessionLookup(env, fetcher = fetch) {
  const endpoint = env.SESSION_LOOKUP_URL;
  const secret = env.SESSION_LOOKUP_SECRET;
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) ||
      typeof secret !== "string" || secret.length < 32) {
    throw new Error("Secure session lookup endpoint and credential required");
  }
  return async function lookupSession(sessionId) {
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Authorization": "Bearer " + secret, "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
      redirect: "error",
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Session lookup unavailable");
    const data = await response.json();
    if (data?.active !== true || !data.session) return null;
    const row = data.session;
    if (row.id !== sessionId || !UUID.test(row.user_id || "")) {
      throw new Error("Invalid authoritative session response");
    }
    return { id: row.id, user_id: row.user_id, not_after: row.not_after ?? null };
  };
}
