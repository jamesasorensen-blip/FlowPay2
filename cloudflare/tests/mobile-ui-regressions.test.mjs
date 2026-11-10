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

test('browser financial records warning can be dismissed without data mutation',()=>{
 assert.match(html,/Dismiss browser financial records notice/);
 assert.match(html,/flowpay_local_warning_dismissed/);
 assert.match(html,/sessionStorage\.getItem\('flowpay_local_warning_dismissed'\)/);
});
test('device login uses credential autofill guidance, not local-session bypass',()=>{
 assert.match(html,/Use saved password \/ device unlock/);
 assert.match(html,/Choose your saved FlowPay login from your phone password manager/);
 assert.match(html,/Verified passkey enrollment is not yet available/);
});
