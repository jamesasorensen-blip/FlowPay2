import test from "node:test";
import assert from "node:assert/strict";
import { verifyActiveSession } from "../mfa-session-check.mjs";

const sub = "00000000-0000-4000-8000-000000000001";
const sid = "00000000-0000-4000-8000-000000000002";
const claims = { sub, session_id: sid };
const active = { id: sid, user_id: sub, not_after: null };
test("active matching session is accepted", async () => {
  assert.equal(await verifyActiveSession(claims, async () => active), true);
});
test("revoked or absent session is denied despite valid JWT claims", async () => {
  assert.equal(await verifyActiveSession(claims, async () => null), false);
});
test("session must belong to the JWT subject", async () => {
  assert.equal(await verifyActiveSession(claims, async () => ({ ...active, user_id: sid })), false);
});
test("missing session id and malformed claims are denied", async () => {
  assert.equal(await verifyActiveSession({ sub }, async () => active), false);
  assert.equal(await verifyActiveSession({ sub, session_id: "invalid" }, async () => active), false);
});
test("expired session and database outage fail closed", async () => {
  assert.equal(await verifyActiveSession(claims, async () => ({ ...active, not_after: "2020-01-01T00:00:00Z" })), false);
  assert.equal(await verifyActiveSession(claims, async () => { throw new Error("offline"); }), false);
});
