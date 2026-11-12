import test from 'node:test';import assert from 'node:assert/strict';
import {suggestReceiptMatchesFromPlaid} from '../receipt-plaid-bridge.mjs';
test('suggests matching posted transaction without booking or attaching',()=>{
 const result=suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:13.97},[{transaction_id:'tx1',date:'2026-11-11',amount:13.97,pending:false,name:'Grocer'}]);
 assert.equal(result.status,'possible-match');assert.equal(result.matches[0].merchant,'Grocer');assert.equal(result.expenseToAddDollars,0);assert.equal(result.autoAttach,false);
});
test('posted transaction supersedes linked pending transaction in bridge',()=>{
 const result=suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:14.12},[{transaction_id:'p1',date:'2026-11-10',amount:13.97,pending:true},{transaction_id:'tx1',pending_transaction_id:'p1',date:'2026-11-11',amount:14.12,pending:false}]);
 assert.deepEqual(result.matchingTransactionIds,['tx1']);
});
test('does not mutate provided bank records',()=>{
 const records=[Object.freeze({transaction_id:'tx1',date:'2026-11-11',amount:13.97})];
 suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:13.97},Object.freeze(records));
 assert.equal(records[0].amount,13.97);
});
