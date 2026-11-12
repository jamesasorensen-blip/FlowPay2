import test from 'node:test';import assert from 'node:assert/strict';import {mapBillRecords} from '../bill-record-adapter.mjs';
test('maps explicit bill fields',()=>assert.deepEqual(mapBillRecords([{amount:120,dueDate:'2026-12-05',status:'unpaid'}]),[{amountDollars:120,dueDate:'2026-12-05',status:'unpaid'}]));
test('rejects unknown statuses to avoid double counting',()=>assert.throws(()=>mapBillRecords([{amount:100,dueDate:'2026-12-05',status:'completed'}])));
test('rejects invalid calendar dates',()=>assert.throws(()=>mapBillRecords([{amount:100,dueDate:'2026-02-30',status:'unpaid'}])));
test('rejects missing amounts rather than guessing',()=>assert.throws(()=>mapBillRecords([{dueDate:'2026-12-05',status:'unpaid'}])));
