import test from "node:test";
import assert from "node:assert/strict";
import worker from "../staging-worker.mjs";

const env = { PLAID_ENV: "sandbox", STAGING_TEST_USER_ID: "00000000-0000-4000-8000-000000000001" };
const request = (path, origin, method = "GET") =>
  new Request("https://staging-api.example.test" + path, { method, headers: origin ? { Origin: origin } : {} });

test("staging frontend receives CORS preflight for financial endpoints", async () => {
  const response = await worker.fetch(request("/bank-accounts", "https://flowpay-staging.onrender.com", "OPTIONS"), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://flowpay-staging.onrender.com");
});
test("untrusted origins cannot preflight", async () => {
  const response = await worker.fetch(request("/bank-accounts", "https://attacker.example", "OPTIONS"), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
test("protected financial endpoint rejects requests without JWT", async () => {
  const response = await worker.fetch(request("/bank-accounts", "https://flowpay-staging.onrender.com"), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Unauthorized");
});
test("staging status exposes no Plaid secret or private data", async () => {
  const response = await worker.fetch(request("/"), { ...env, PLAID_SECRET: "never-echo" });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(body.includes("never-echo"), false);
});
