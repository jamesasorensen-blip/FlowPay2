import test from 'node:test';import assert from 'node:assert/strict';import {mapPlaidTransactions} from '../plaid-transaction-adapter.mjs';
test('maps spending with stable identifiers',()=>assert.deepEqual(mapPlaidTransactions([{transaction_id:'tx1',date:'2026-11-11',amount:13.97,pending:false,merchant_name:'Market'}]),[{id:'tx1',date:'2026-11-11',amountDollars:13.97,pending:false,merchant:'Market'}]));
test('excludes refunds and invalid dates',()=>assert.equal(mapPlaidTransactions([{transaction_id:'refund',date:'2026-11-11',amount:-13.97},{transaction_id:'invalid',date:'2026-02-30',amount:13.97}]).length,0));
test('deduplicates transaction IDs',()=>assert.equal(mapPlaidTransactions([{transaction_id:'tx',date:'2026-11-11',amount:13.97},{transaction_id:'tx',date:'2026-11-11',amount:13.97}]).length,1));
test('retains pending marker for review',()=>assert.equal(mapPlaidTransactions([{transaction_id:'tx',date:'2026-11-11',amount:13.97,pending:true}])[0].pending,true));
