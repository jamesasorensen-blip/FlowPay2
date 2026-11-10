import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf("const API = 'https://flowpay-plaid-api-staging");
const end=html.indexOf('<!-- End account-scoped cloud synchronization -->',start);
const cloud=html.slice(start,end);

test('paused cloud synchronization offers a local backup action',()=>{
 assert.match(cloud,/exportButton\.id = 'flowpay-export-local-backup'/);
 assert.match(cloud,/exportButton\.style\.display = activeId && \(paused \|\| changedDuringLoad \|\| dirty\) \? 'block' : 'none'/);
});
test('backup exports account-scoped browser records without sending a cloud write',()=>{
 const start=cloud.indexOf("exportButton.addEventListener('click'");
 const end=cloud.indexOf('const flush = async',start);
 const action=cloud.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(action,/localStorage\.getItem\(cacheKey\(activeId\)\)/);
 assert.match(action,/JSON\.parse\(cached\)/);
 assert.match(action,/backup\(snapshot, 'flowpay-local-backup-'/);
 assert.doesNotMatch(action,/request\('PUT'/);
 assert.doesNotMatch(action,/localStorage\.removeItem/);
});
