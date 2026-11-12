'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const core=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(x=>x[1].includes('const defaults='))[1];
function app(){
 class Clock extends Date {constructor(...args){super(...(args.length?args:['2026-11-25T12:00:00Z']))}}
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',style:{},classList:{toggle(){},contains(){return true}}});return nodes.get(id)};
 const context=vm.createContext({window:{addEventListener(){}},document:{getElementById:node,documentElement:{classList:{toggle(){}}}},Date:Clock,Intl,crypto:require('node:crypto').webcrypto});
 vm.runInContext(core,context);
 vm.runInContext(`state={...defaults,balance:1000,emergencyBuffer:0,essentialSpending:0,pendingTransactions:0,bills:[{id:'monthly',name:'Rent',amount:100,frequency:'monthly',dueDate:'2026-12-01'},{id:'unselected',name:'Other',amount:50,frequency:'monthly',dueDate:'2026-12-10'},{id:'weekly',name:'Weekly',amount:10,frequency:'weekly',dueDate:'2026-11-27'}],paychecks:[{date:'2026-12-05',status:'actual',amount:200}],paidOccurrences:['weekly|2026-12-11'],includedNextMonthBillIds:['monthly','weekly']};`,context);
 return {context,nodes};
}
test('button total covers selected unpaid monthly and weekly occurrences',()=>{
 const h=app();assert.equal(vm.runInContext('nextMonthCoverageTotal()',h.context),130);
 vm.runInContext("state.paidOccurrences.push('monthly|2026-12-01')",h.context);assert.equal(vm.runInContext('nextMonthCoverageTotal()',h.context),30);
 vm.runInContext('state.includedNextMonthBillIds=[]',h.context);assert.equal(vm.runInContext('nextMonthCoverageTotal()',h.context),0);
});
test('next-month button amount includes coverage already reserved before payday without double-counting',()=>{
 const h=app();assert.equal(vm.runInContext('nextMonthCoverageTotal()',h.context),130);
 assert.equal(vm.runInContext('safeBreakdown().nextTotal',h.context),20);
 assert.equal(vm.runInContext('safeBreakdown().billTotal',h.context),120);
 assert.equal(vm.runInContext('safeBreakdown().safe',h.context),860);
});
test('button and selection summary update to dollars after selections change',()=>{
 const h=app();vm.runInContext('renderBills=()=>{};renderPaychecks=()=>{};renderActivity=()=>{};renderCalendar=()=>{};render()',h.context);
 assert.equal(h.nodes.get('included-next-bills-amount').textContent,'$130.00');
 assert.equal(h.nodes.get('next-month-selection-summary').textContent,'Selected bills to cover: $130.00');
 vm.runInContext('state.includedNextMonthBillIds=[];render()',h.context);
 assert.equal(h.nodes.get('included-next-bills-amount').textContent,'$0.00');
});

