import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('bank connections panel is hidden until explicitly opened',()=>{
  assert.match(html,/id="flowpay-plaid-panel"[^>]*display:none/);
  assert.match(html,/id="flowpay-bank-panel-explicit-open-script"/);
  assert.match(html,/panel\.dataset\.panelOpen='false'/);
  assert.match(html,/panel\.dataset\.panelOpen='true'/);
  assert.match(html,/#flowpay-plaid-panel\[data-panel-open="false"\]\s*\{\s*display:none\s*!important/);
});

test('bank panel has an explicit accessible toggle and close control',()=>{
  assert.match(html,/trigger\.id='flowpay-open-bank-panel'/);
  assert.match(html,/trigger\.setAttribute\('aria-controls','flowpay-plaid-panel'\)/);
  assert.match(html,/trigger\.setAttribute\('aria-expanded','false'\)/);
  assert.match(html,/flowpay-close-bank-panel/);
});

test('bank panel closes on account changes and stays hidden while signed out',()=>{
  assert.match(html,/window\.addEventListener\('flowpay-auth-user-changed',event=>\{close\(\)/);
  assert.match(html,/trigger\.hidden=!signedIn/);
  assert.match(html,/document\.addEventListener\('visibilitychange'/);
});
