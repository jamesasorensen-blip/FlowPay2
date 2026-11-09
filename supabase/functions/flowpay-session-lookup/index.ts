// Staging-only private service. NOT DEPLOYED. Requires a separate shared secret
// and SUPABASE_DB_URL in server-side secrets. Never expose this endpoint publicly
// without authentication. Set verify_jwt=false only when this shared-secret check
// is intentionally used as the authentication mechanism.
import postgres from "npm:postgres@3.4.3";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const sharedSecret = Deno.env.get("FLOWPAY_SESSION_LOOKUP_SECRET");
const stagingUserId = Deno.env.get("FLOWPAY_STAGING_TEST_USER_ID");
const sql = dbUrl ? postgres(dbUrl, { prepare: false, max: 2, idle_timeout: 10 }) : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

async function authorized(header: string | null): Promise<boolean> {
  if (!sharedSecret || sharedSecret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const candidate = header.slice(7);
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const a = await digest(candidate);
  const b = await digest(sharedSecret);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (request) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (!(await authorized(request.headers.get("Authorization")))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  // The project is shared with production. Do not serve a general-purpose
  // session oracle: this function must be limited to the staging test user.
  if (!sql || !stagingUserId || !uuid.test(stagingUserId)) {
    return Response.json({ error: "Unavailable" }, { status: 503, headers });
  }
  try {
    const body = await request.text();
    if (body.length > 256) return Response.json({ error: "Invalid request" }, { status: 400, headers });
    const { session_id } = JSON.parse(body);
    if (typeof session_id !== "string" || !uuid.test(session_id)) {
      return Response.json({ error: "Invalid session" }, { status: 400, headers });
    }
    const rows = await sql`
      select id::text, user_id::text, not_after
      from auth.sessions
      where id = ${session_id}::uuid
        and user_id = ${stagingUserId}::uuid
      limit 1
    `;
    const row = rows[0];
    const expiry = row?.not_after == null ? null : new Date(row.not_after).getTime();
    if (!row || (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now()))) {
      return Response.json({ active: false }, { headers });
    }
    return Response.json({
      active: true,
      session: { id: row.id, user_id: row.user_id, not_after: row.not_after }
    }, { headers });
  } catch {
    return Response.json({ error: "Lookup unavailable" }, { status: 503, headers });
  }
});
