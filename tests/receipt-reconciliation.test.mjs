import test from 'node:test';import assert from 'node:assert/strict';import {reconcileReceipt} from '../receipt-reconciliation.mjs';
test('matching receipt never creates second expense',()=>assert.deepEqual(reconcileReceipt({date:'2026-11-11',totalDollars:13.97},[{id:'tx1',date:'2026-11-12',amountDollars:13.97}]),{status:'possible-match',matchingTransactionIds:['tx1'],expenseToAddDollars:0,requiresReview:true}));
test('ambiguous equal totals require review',()=>assert.equal(reconcileReceipt({date:'2026-11-11',totalDollars:13.97},[{id:'a',date:'2026-11-11',amountDollars:13.97},{id:'b',date:'2026-11-11',amountDollars:13.97}]).status,'ambiguous'));
test('unmatched receipt not automatically booked',()=>assert.equal(reconcileReceipt({date:'2026-11-11',totalDollars:13.97},[]).expenseToAddDollars,0));

test('rejects impossible receipt calendar dates',()=>assert.throws(()=>reconcileReceipt({date:'2026-02-30',totalDollars:13.97},[])));
test('ignores invalid transaction dates and missing identifiers',()=>assert.equal(reconcileReceipt({date:'2026-11-11',totalDollars:13.97},[{id:'invalid',date:'2026-02-30',amountDollars:13.97},{date:'2026-11-11',amountDollars:13.97}]).status,'unmatched'));

test('rejects fractional-cent receipt amounts',()=>assert.throws(()=>reconcileReceipt({date:'2026-11-11',totalDollars:13.975},[])));
test('ignores fractional-cent bank amounts',()=>assert.equal(reconcileReceipt({date:'2026-11-11',totalDollars:13.97},[{id:'fractional',date:'2026-11-11',amountDollars:13.975}]).status,'unmatched'));
