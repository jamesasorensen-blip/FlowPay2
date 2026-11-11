import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bankSection=html.slice(html.indexOf('  async function loadBanks()'),html.indexOf('  // Sandbox-only suggestions.'));
test('bank connections has authenticated per-connection read-only webhook check',()=>{
  assert.match(bankSection,/Check webhook configuration/);
  assert.match(bankSection,/api\('\/diagnostics\/item-webhook','POST',\{connection_id:id\}\)/);
  assert.match(bankSection,/if \(gen !== generation\) return/);
  assert.match(bankSection,/webhook_matches_staging/);
  assert.match(bankSection,/Webhook check failed/);
});
