import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../cloudflare/staging-worker.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('Sandbox webhook trigger requires authenticated owned connection and consent',()=>{
 const section=worker.slice(worker.indexOf('if (url.pathname === "/diagnostics/fire-webhook"'),worker.indexOf('// BANK ACCOUNTS',worker.indexOf('if (url.pathname === "/diagnostics/fire-webhook"')));
 assert.match(section,/if \(!allowed\)/);
 assert.match(section,/getConnection\(env, user.id, body.connection_id\)/);
 assert.match(section,/hasBankConsent\(env, user.id, connection.id\)/);
 assert.match(section,/item\?\.item\?\.webhook !== expected/);
 assert.match(section,/\/sandbox\/item\/fire_webhook/);
 assert.match(section,/delivery_verified: false/);
 assert.doesNotMatch(section,/access_token: accessToken\s*\}/);
});
test('Staging test button reports acknowledgement separately from delivery',()=>{
 assert.match(html,/Send test webhook/);
 assert.match(html,/api\('\/diagnostics\/fire-webhook','POST',\{connection_id:id\}\)/);
 assert.match(html,/Check Cloudflare staging logs/);
});
