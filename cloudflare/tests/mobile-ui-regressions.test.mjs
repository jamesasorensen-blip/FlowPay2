import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');

test('bank panel stays closed unless explicitly opened and closes on auth changes',()=>{
 assert.match(html,/panel\.dataset\.panelOpen='false'/);
 assert.match(html,/function open\(\)\{if\(!window\.flowpayActiveUserId\)return/);
 assert.match(html,/trigger\.addEventListener\('click',\(\)=>panel\.dataset\.panelOpen==='true'\?close\(\):open\(\)\)/);
 assert.match(html,/window\.addEventListener\('flowpay-auth-user-changed',event=>\{close\(\)/);
 assert.match(html,/#flowpay-plaid-panel\[data-panel-open="false"\]\s*\{\s*display:none\s*!important/);
});

test('cloud notice can be dismissed and stays hidden on subsequent updates',()=>{
 assert.match(html,/aria-label="Dismiss cloud status"/);
 assert.match(html,/sessionStorage\.setItem\('flowpay-cloud-notice-dismissed', '1'\)/);
 assert.match(html,/sessionStorage\.getItem\('flowpay-cloud-notice-dismissed'\) === '1'/);
 assert.match(html,/cloudObserver\.observe\(notice/);
});

test('mobile header and bank panel have responsive layout',()=>{
 assert.match(html,/#fp-toolbar\{display:flex;align-items:center;gap:8px;flex-wrap:wrap\}/);
 assert.match(html,/#flowpay-plaid-panel\[data-panel-open="true"\][^}]*max-width:calc\(100vw - 24px\)/);
});

test('financial records warning can be dismissed without touching stored records',()=>{
 assert.match(html,/Dismiss financial data notice/);
 assert.match(html,/sessionStorage\.setItem\('flowpay-financial-notice-dismissed', '1'\)/);
 assert.match(html,/sessionStorage\.getItem\('flowpay-financial-notice-dismissed'\) === '1'/);
});

test('device login offers password-manager guidance without client-only session bypass',()=>{
 const start=html.indexOf('function updateBiometricUI(){');
 const end=html.indexOf('function showAuth(){',start);
 assert.ok(start>=0 && end>start);
 const section=html.slice(start,end);
 assert.match(section,/Use saved password \/ device unlock/);
 assert.match(section,/Choose your saved FlowPay login from your phone password manager/);
 assert.match(section,/Verified passkey enrollment is not yet available/);
 assert.doesNotMatch(section,/sessionStorage\.setItem\('flowpay_session_active'/);
 assert.doesNotMatch(section,/navigator\.credentials\.get\(/);
});
