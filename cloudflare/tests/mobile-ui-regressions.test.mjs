import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
test('auth refresh cannot reopen a dismissed bank panel',()=>{
 assert.match(html,/if \(bank && !activeUser\) bank\.style\.display = 'none'/);
 assert.doesNotMatch(html,/bank\.style\.display = activeUser \? '' : 'none'/);
 assert.match(html,/closeBanksButton\.addEventListener\('click', \(\) => setBankPanelOpen\(false\)\)/);
});
test('cloud data notice can be closed and remains closed on subsequent sync',()=>{
 assert.match(html,/aria-label', 'Close cloud data notice/);
 assert.match(html,/cloudNoticeDismissed = true/);
 assert.match(html,/id && !cloudNoticeDismissed/);
});
test('mobile header and shortcuts use responsive layout',()=>{
 assert.match(html,/#fp4-shortcuts\{display:none!important\}/);
 assert.match(html,/header:has\(#fp-toolbar\)\{display:flex;flex-wrap:wrap/);
 assert.match(html,/#fp-toolbar\{width:100%;min-width:0/);
});
