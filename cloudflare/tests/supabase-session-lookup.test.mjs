import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseSessionLookup } from "../supabase-session-lookup.mjs";
const id = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000001";
const env = { SESSION_LOOKUP_URL: "https://private.example.test/session", SESSION_LOOKUP_SECRET: "x".repeat(40) };
test("valid private response returns only session verification fields", async () => {
  const lookup = createSupabaseSessionLookup(env, async (url, init) => {
    assert.equal(url, env.SESSION_LOOKUP_URL);
    assert.equal(init.headers.Authorization, "Bearer " + env.SESSION_LOOKUP_SECRET);
    assert.equal(JSON.parse(init.body).session_id, id);
    return Response.json({ active: true, session: { id, user_id: user, not_after: null, secret: "do not forward" } });
  });
  assert.deepEqual(await lookup(id), { id, user_id: user, not_after: null });
});
test("missing secret is rejected", () => {
  assert.throws(() => createSupabaseSessionLookup({ SESSION_LOOKUP_URL: env.SESSION_LOOKUP_URL }), /credential/);
});
test("revoked session is rejected", async () => {
  const lookup = createSupabaseSessionLookup(env, async () => Response.json({ active: false }));
  assert.equal(await lookup(id), null);
});
test("mismatched authoritative session id is rejected", async () => {
  const lookup = createSupabaseSessionLookup(env, async () => Response.json({ active: true, session: { id: user, user_id: user } }));
  await assert.rejects(lookup(id), /Invalid authoritative/);
});
test("lookup transport failure rejects rather than permitting access", async () => {
  const lookup = createSupabaseSessionLookup(env, async () => new Response("offline", { status: 503 }));
  await assert.rejects(lookup(id), /unavailable/);
});
