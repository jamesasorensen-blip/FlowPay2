import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
test("bank connections are dismissible and can be reopened", () => {
  assert.match(source, /id="flowpay-close-banks"/);
  assert.match(source, /openBanksButton\.id = 'flowpay-open-banks'/);
  assert.match(source, /closeBanksButton\.addEventListener\('click', \(\) => setBankPanelOpen\(false\)\)/);
  assert.match(source, /openBanksButton\.addEventListener\('click', \(\) => setBankPanelOpen\(true\)\)/);
});
test("sign-in does not force the bank panel over the app", () => {
  assert.match(source, /function authChanged\(id\) \{[\s\S]{0,150}setBankPanelOpen\(false\)/);
  assert.doesNotMatch(source, /panel\.style\.display=currentUser \? 'block' : 'none'/);
});

test("mobile PWA links to the actual install manifest", () => {
  assert.match(source, /<link rel="manifest" href="\/manifest\.json">/);
  assert.doesNotMatch(source, /rel="manifest" href="manifest\.webmanifest"/);
});
