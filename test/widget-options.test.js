'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('scripts/widget-options-runtime.txt','utf8');
const prefix=source.slice(0,source.indexOf('// UI'));
const model=vm.runInNewContext(prefix+'return {freshPreferences,cleanPreferences,activityKind,selectedActivity,sortedBillRows};})();');
test('invalid saved layouts cannot drop widgets, duplicate order IDs, or inject unknown preferences',()=>{
 const p=model.cleanPreferences({widgets:{balance:{hidden:true,collapsed:'yes'},unknown:{hidden:true}},cards:['balance','balance','balance','balance'],groups:['bills','metrics','safespend'],activityLimit:99999,billSort:'injected',coverageUnpaid:false});
 assert.equal(p.widgets.balance.hidden,true);assert.equal(p.widgets.balance.collapsed,false);assert.equal(p.widgets.unknown,undefined);assert.equal(p.cards.join(','),'balance,nextbill,activebills,savings');assert.equal(p.groups.join(','),'bills,metrics,safespend');assert.equal(p.activityLimit,15);assert.equal(p.billSort,'due');assert.equal(p.coverageUnpaid,false);
});
test('bill filters and ordering never mutate rows or the original financial input',()=>{
 const input=[{name:'Rent',category:'Housing',amount:950,date:'2026-12-01'},{name:'Phone',category:'Utilities',amount:80,date:'2026-11-30'},{name:'Electric',category:'Utilities',amount:120,date:'2026-11-20'}],before=JSON.stringify(input);
 assert.deepEqual(model.sortedBillRows(input,'Utilities','amount-desc').map(r=>r.name),['Electric','Phone']);assert.equal(model.sortedBillRows(input,'all','due')[0].name,'Electric');assert.equal(JSON.stringify(input),before);
});
test('activity filters preserve stored history and respect the chosen visible limit',()=>{
 const input=[{message:'Bill marked paid'},{message:'Paycheck saved'},{message:'Balance manually updated'},{message:'Bill payment reversed'}],before=JSON.stringify(input);
 assert.equal(model.selectedActivity(input,'bills',1).length,1);assert.equal(model.selectedActivity(input,'income',15)[0].message,'Paycheck saved');assert.equal(JSON.stringify(input),before);
});
test('browser preferences are separate for guest mode and each signed-in user',()=>{
 const reads=[],records=new Map(),localStorage={getItem:k=>{reads.push(k);return records.get(k)||null}};
 records.set('flowpay_widget_display_v1:alice',JSON.stringify({widgets:{balance:{hidden:true}}}));
 const helpers=source.slice(source.indexOf('function ownerKey()'),source.indexOf('function persist()'));
 const c=vm.createContext({window:{flowpayActiveUserId:'alice'},localStorage,console});
 vm.runInContext(prefix+'let prefs=freshPreferences(),scopeKey=null;'+helpers+'window.read=()=>{readPrefs();return prefs};})();',c);
 assert.equal(c.window.read().widgets.balance.hidden,true);c.window.flowpayActiveUserId='bob';assert.equal(c.window.read().widgets.balance.hidden,false);assert.deepEqual(reads,['flowpay_widget_display_v1:alice','flowpay_widget_display_v1:bob']);
 const guestReads=[];const g=vm.createContext({window:{},guestStorage:{getItem:k=>{guestReads.push(k);return null}},localStorage:{getItem(){throw Error('Guest accessed production storage')}}});
 vm.runInContext(prefix+'let prefs=freshPreferences(),scopeKey=null;'+helpers+'readPrefs();})();',g);assert.deepEqual(guestReads,['widget-display-v1']);
});
test('widget display code has no financial API, auth calls, or automatic record deletion',()=>{
 for(const forbidden of ['fetch(','XMLHttpRequest','supabase','workers.dev','state.bills=','state.paychecks=','state.balance='])assert.equal(source.includes(forbidden),false,forbidden);
 assert.ok(source.includes("button('Clear activity history',()=>{state.activity=[]"));assert.ok(source.includes('This cannot be undone.'));
});
