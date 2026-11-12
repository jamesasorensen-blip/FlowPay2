import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const build=readFileSync(new URL('../scripts/build-guest-demo.mjs',import.meta.url),'utf8');
const tour=readFileSync(new URL('../scripts/guest-tour-runtime.txt',import.meta.url),'utf8');
test('guest builder embeds isolated guided tour',()=>{
 assert.match(build,/guest-tour-runtime\.txt/);
 assert.match(build,/\+tourRuntime\+/);
 assert.match(build,/#guest-tour-overlay/);
});
test('guided tour is dismissible, replayable, and locally remembered',()=>{
 for(const text of ['tour-complete-v1','guest-tour-next','guest-tour-skip','guest-tour-restart','guestStorage.setItem','aria-modal="true"','requestAnimationFrame(position)'])assert.ok(tour.includes(text),text);
});
test('guided tour never mutates budget or invokes financial actions',()=>{
 for(const forbidden of ['guestReset(','state.balance=','state.bills=','fetch(','XMLHttpRequest','form.submit(','\.click('])assert.equal(tour.includes(forbidden),false,forbidden);
});
