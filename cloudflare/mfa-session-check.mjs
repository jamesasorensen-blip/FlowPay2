// Server-only helper. Call AFTER JWT signature, issuer, audience and expiry verification.
// The supplied lookup MUST query authoritative auth.sessions data using server credentials;
// never trust a client-provided session status or expose service credentials in the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function verifyActiveSession(claims, lookupSession, now = Date.now()) {
  if (!claims || typeof claims !== "object" ||
      typeof claims.sub !== "string" || !UUID.test(claims.sub) ||
      typeof claims.session_id !== "string" || !UUID.test(claims.session_id) ||
      typeof lookupSession !== "function") return false;
  try {
    const row = await lookupSession(claims.session_id);
    if (!row || row.id !== claims.session_id || row.user_id !== claims.sub) return false;
    if (row.not_after != null) {
      const expiry = Date.parse(row.not_after);
      if (!Number.isFinite(expiry) || expiry <= now) return false;
    }
    return true;
  } catch {
    // Financial endpoints must fail closed on session-store outage.
    return false;
  }
}
