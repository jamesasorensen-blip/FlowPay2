'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('staging Plaid sync validates every page before any database mutation', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const syncStart = worker.indexOf('if (url.pathname === "/sync-transactions"');
  const historyStart = worker.indexOf('// TRANSACTION HISTORY', syncStart);
  assert.ok(syncStart >= 0 && historyStart > syncStart, 'sync route missing');
  const route = worker.slice(syncStart, historyStart);
  for (const field of ['added', 'modified', 'removed']) {
    assert.ok(route.includes('Array.isArray(page.' + field + ')'), field + ' must be validated');
  }
  assert.ok(route.includes('typeof page.next_cursor !== "string"'));
  assert.ok(route.includes('typeof page.has_more !== "boolean"'));
  assert.ok(route.includes('page.has_more && page.next_cursor === cursor'));
  const validation = route.indexOf('Invalid transaction sync response; no changes saved');
  const firstWrite = route.indexOf('await saveTransaction(env, tx)');
  assert.ok(validation >= 0 && firstWrite > validation, 'validation must precede transaction writes');
});

test('staging bank upserts cannot overwrite records owned by another account', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const accounts = worker.slice(worker.indexOf('async function saveAccounts('), worker.indexOf('async function saveTransaction('));
  const transactions = worker.slice(worker.indexOf('async function saveTransaction('), worker.indexOf('async function readJson('));
  assert.match(accounts, /ON CONFLICT\(id\) DO UPDATE SET[\s\S]*WHERE bank_accounts\.connection_id = excluded\.connection_id/);
  assert.match(transactions, /ON CONFLICT\(id\) DO UPDATE SET[\s\S]*WHERE bank_transactions\.account_id = excluded\.account_id/);
});
