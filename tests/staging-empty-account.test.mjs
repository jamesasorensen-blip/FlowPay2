import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  const normalized = data => {'),html.indexOf('  const useState ='));
const defaults={balance:500,emergencyBuffer:75,essentialSpending:100,pendingTransactions:0,savingsGoal:200,bills:[],paychecks:[],paidOccurrences:[],includedNextMonthBillIds:[],activity:[],bankMatchDecisions:[],incomePatternDecisions:[],widgetOrder:['safespend','metrics','bills'],bankBalanceSettings:{mode:'manual',accountId:''}};
const h=Function('defaults','structuredClone',source+';return {normalized,emptyAccount};')(defaults,structuredClone);
test('new empty staging account has zero monetary values and no financial entries',()=>{
 const empty=h.emptyAccount();for(const key of ['balance','emergencyBuffer','essentialSpending','pendingTransactions','savingsGoal'])assert.equal(empty[key],0,key);
 for(const key of ['bills','paychecks','activity','paidOccurrences'])assert.deepEqual(empty[key],[],key);
});
test('normalizing one account cannot mutate another account or shared defaults',()=>{
 const a=h.normalized({}),b=h.normalized({});a.bills.push({name:'Account A only'});a.bankBalanceSettings.accountId='private-A';a.widgetOrder.reverse();
 assert.deepEqual(b.bills,[]);assert.deepEqual(defaults.bills,[]);assert.equal(b.bankBalanceSettings.accountId,'');assert.deepEqual(defaults.widgetOrder,['safespend','metrics','bills']);
});
test('empty-account guard treats any existing nonzero manual balance as data to preserve',()=>{assert.notEqual(JSON.stringify(h.normalized({balance:500})),JSON.stringify(h.emptyAccount()));});
