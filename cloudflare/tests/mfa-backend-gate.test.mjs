import test from "node:test";
import assert from "node:assert/strict";
import { requiresMfa } from "../staging-worker.mjs";

const protectedRoutes = [
  ["/test-plaid","GET"], ["/link-token","POST"], ["/exchange-token","POST"],
  ["/user-data","GET"], ["/bank-accounts","GET"],
  ["/bank-transactions","GET"], ["/sync-transactions","POST"],
  ["/consent","GET"], ["/consent","POST"], ["/consent/withdraw","POST"],
  ["/my-data","GET"], ["/bank-connections/00000000-0000-4000-8000-000000000000","DELETE"]
];
test("AAL1 is denied for every financial endpoint when enforcement is on", () => {
  for (const [path, method] of protectedRoutes) {
    assert.equal(requiresMfa({ aal: "aal1" }, { REQUIRE_MFA_AAL2: "true" }, path, method), true, path);
    assert.equal(requiresMfa({ aal: undefined }, { REQUIRE_MFA_AAL2: "true" }, path, method), true, path);
  }
});
test("AAL2 is allowed past MFA gate for every financial endpoint", () => {
  for (const [path, method] of protectedRoutes) {
    assert.equal(requiresMfa({ aal: "aal2" }, { REQUIRE_MFA_AAL2: "true" }, path, method), false, path);
  }
});
test("only GET /me is exempt for AAL1 enrollment identification", () => {
  const env = { REQUIRE_MFA_AAL2: "true" };
  assert.equal(requiresMfa({ aal: "aal1" }, env, "/me", "GET"), false);
  assert.equal(requiresMfa({ aal: "aal1" }, env, "/me", "POST"), true);
  assert.equal(requiresMfa({ aal: "aal1" }, env, "/my-data", "GET"), true);
});
test("switch is explicitly opt-in, not enabled by any other truthy value", () => {
  assert.equal(requiresMfa({ aal: "aal1" }, {}, "/user-data", "GET"), false);
  assert.equal(requiresMfa({ aal: "aal1" }, { REQUIRE_MFA_AAL2: "false" }, "/user-data", "GET"), false);
});
