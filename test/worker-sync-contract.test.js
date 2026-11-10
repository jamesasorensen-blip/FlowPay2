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
  const batchWrite = route.indexOf('await env.DB.batch(statements)');
  assert.ok(validation >= 0 && batchWrite > validation, 'validation must precede transaction writes');
});

test('staging bank upserts cannot overwrite records owned by another account', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const accounts = worker.slice(worker.indexOf('async function saveAccounts('), worker.indexOf('function transactionStatement('));
  const transactions = worker.slice(worker.indexOf('function transactionStatement('), worker.indexOf('async function readJson('));
  assert.match(accounts, /ON CONFLICT\(id\) DO UPDATE SET[\s\S]*WHERE bank_accounts\.connection_id = excluded\.connection_id/);
  assert.match(transactions, /ON CONFLICT\(id\) DO UPDATE SET[\s\S]*WHERE bank_transactions\.account_id = excluded\.account_id/);
});

test('staging sync commits transactions, cursor and audit together', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  assert.match(route, /\.\.\.additions\.map\(tx => transactionStatement\(env, tx\)\)/);
  assert.match(route, /\.\.\.modifications\.map\(tx => transactionStatement\(env, tx\)\)/);
  assert.match(route, /\.\.\.removals\.map\(tx => env\.DB\.prepare\(/);
  assert.match(route, /SET sync_cursor = \?, last_synced_at = CURRENT_TIMESTAMP/);
  assert.match(route, /"transactions_synced"/);
  assert.match(route, /await env\.DB\.batch\(statements\)/);
  assert.doesNotMatch(route, /await saveTransaction\(/);
});

test('staging sync rejects oversized batches before database mutation', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  const guard = route.indexOf('if (statementCount > 500)');
  const batch = route.indexOf('await env.DB.batch(statements)');
  assert.ok(guard >= 0 && batch > guard, 'batch limit must precede atomic write');
  assert.match(route, /Transaction sync batch too large; no changes saved/);
});

test('staging sync rejects malformed transaction identifiers and amounts before writes', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  const check = route.indexOf('Invalid transaction fields; no changes saved');
  const batch = route.indexOf('await env.DB.batch(statements)');
  assert.ok(check >= 0 && batch > check);
  assert.match(route, /Number\.isFinite\(tx\.amount\)/);
  assert.match(route, /Invalid removed transaction; no changes saved/);
});

test('staging validates transaction objects before reading account ownership', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  const validation = route.indexOf('Invalid transaction fields; no changes saved');
  const ownership = route.indexOf('if (!accountIds.has(tx.account_id))');
  assert.ok(validation >= 0 && ownership > validation, 'malformed transaction validation must precede account lookup');
});

test('staging sync bounds pagination accumulation before pushing records', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  const bound = route.indexOf('additions.length + modifications.length + removals.length +');
  const push = route.indexOf('additions.push(...page.added)');
  assert.ok(bound >= 0 && push > bound, 'limit records before accumulation');
});

test('staging sync restarts mutation-affected pagination from committed cursor', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'staging-worker.mjs'), 'utf8');
  const route = worker.slice(worker.indexOf('// TRANSACTION SYNCHRONIZATION'), worker.indexOf('// TRANSACTION HISTORY'));
  assert.match(route, /TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION/);
  assert.match(route, /paginationRestarts < 2/);
  assert.match(route, /cursor = initialCursor/);
  for (const name of ['additions', 'modifications', 'removals']) {
    assert.ok(route.includes(name + ' = [];'), name + ' must be reset');
  }
  const batch = route.indexOf('await env.DB.batch(statements)');
  const restart = route.indexOf('cursor = initialCursor', route.indexOf('catch (error)'));
  assert.ok(restart >= 0 && batch > restart, 'pagination restart must precede any writes');
});
