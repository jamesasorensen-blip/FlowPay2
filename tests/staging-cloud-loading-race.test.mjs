import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf("const API = 'https://flowpay-plaid-api-staging");
const end=html.indexOf('async function switchUser(id)',start);
const switchStart=end;
const switchEnd=html.indexOf("freshButton.addEventListener('click'",switchStart);
const callback=html.slice(start,end),switcher=html.slice(switchStart,switchEnd);

test('changes while loading pause sync and are tracked before remote response',()=>{
 assert.match(callback,/if \(!ready\) \{\s*changedDuringLoad = true;\s*paused = true;/);
 assert.match(switcher,/changedDuringLoad = false/);
 assert.match(switcher,/if \(changedDuringLoad\) \{ paused = true; setStatus\('Cloud load stopped:/);
});

test('cloud fetch error cannot overwrite local edits made during loading',()=>{
 assert.match(switcher,/if \(changedDuringLoad\) \{ setStatus\('Cloud load stopped after local edits/);
 assert.match(switcher,/const cached = localStorage\.getItem\(cacheKey\(id\)\)/);
});
