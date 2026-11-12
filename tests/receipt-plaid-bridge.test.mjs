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

test('scoped matching excludes other accounts even with same amount and date',()=>{
 const records=[{transaction_id:'a',account_id:'account-a',date:'2026-11-11',amount:13.97},{transaction_id:'b',account_id:'account-b',date:'2026-11-11',amount:13.97}];
 const result=suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:13.97},records,{accountId:'account-a'});
 assert.deepEqual(result.matchingTransactionIds,['a']);
});
test('scoped matching excludes records missing account identifiers',()=>{
 const result=suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:13.97},[{transaction_id:'no-account',date:'2026-11-11',amount:13.97}],{accountId:'account-a'});
 assert.equal(result.status,'unmatched');
});
test('invalid account scopes fail closed',()=>assert.throws(()=>suggestReceiptMatchesFromPlaid({date:'2026-11-11',totalDollars:13.97},[],{accountId:''})));
