import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf("importButton.addEventListener('click',async () => {");
const end=html.indexOf('// MFA may upgrade',start);
const importHandler=html.slice(start,end);

test('legacy import rejects missing or malformed original data',()=>{
 assert.ok(start>=0&&end>start);
 assert.match(importHandler,/localStorage\.getItem\('flowpay_state'\)/);
 assert.match(importHandler,/!legacy \|\| typeof legacy !== 'object' \|\| Array\.isArray\(legacy\)/);
});

test('legacy import protects existing account-scoped browser data',()=>{
 assert.match(importHandler,/localStorage\.getItem\(cacheKey\(activeId\)\)/);
 assert.match(importHandler,/accountCache !== null/);
 assert.match(importHandler,/JSON\.stringify\(normalized\(cachedAccount\)\) !== JSON\.stringify\(normalized\(legacy\)\)/);
 assert.match(importHandler,/Import blocked to prevent replacing them/);
});

test('legacy import requires confirmation and backs up original data before write',()=>{
 const confirmation=importHandler.indexOf("if (!confirm(");
 const backup=importHandler.indexOf("backup(legacy,'flowpay-original-browser-backup.json')");
 const write=importHandler.indexOf("request('PUT'");
 assert.ok(confirmation>=0&&backup>confirmation&&write>backup);
});
