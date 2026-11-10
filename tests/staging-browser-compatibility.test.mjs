import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../staging-public/manifest.webmanifest',import.meta.url),'utf8'));

test('mobile browser viewport and PWA metadata are present',()=>{
 assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
 assert.match(html,/<link rel="manifest" href="manifest\.webmanifest">/);
 assert.ok(manifest.name && manifest.short_name && manifest.icons?.length);
});

test('device sign-in checks secure context and WebAuthn before use',()=>{
 assert.match(html,/function biometricSupported\(\)\{return !!\(window\.isSecureContext&&window\.PublicKeyCredential&&navigator\.credentials/);
 assert.match(html,/if\(!biometricSupported\(\)\)/);
 assert.match(html,/userVerification:'required'/);
});

test('bank linking uses supported Plaid Link callback rather than a pop-up assumption',()=>{
 assert.match(html,/window\.Plaid\.create\(\{/);
 assert.match(html,/onSuccess:async \(publicToken,metadata\)/);
});

test('cross-browser cloud changes use revisioned writes and pause on conflict',()=>{
 assert.match(html,/request\('PUT',\{revision,data:snapshot\}\)/);
 assert.match(html,/if \(res\.status === 409\)/);
 assert.match(html,/paused = true;\s*setStatus\('Cloud conflict:/);
});
