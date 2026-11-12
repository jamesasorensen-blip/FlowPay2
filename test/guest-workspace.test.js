'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,['scripts/build-guest-demo.mjs']);
const html=fs.readFileSync('guest-demo.html','utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
test('guest output retains original app and excludes all remote financial integrations',()=>{
 for(const id of ['view-dashboard','view-calendar','view-projection','view-calculator','form-bill','form-balance','form-paycheck-calc','flowpay-ui-refresh-script','fp-stage2-script','fp-stage3-script','fp4-script'])assert.ok(html.includes('id="'+id+'"'),id);
 for(const forbidden of ['supabase.co','workers.dev','cdn.plaid.com','flowpayGetAccessToken','flowpay_session_active','flowpay_user_account','fetch(','XMLHttpRequest','sendBeacon','serviceWorker.register'])assert.ok(!html.includes(forbidden),forbidden);
 assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);
 assert.ok(!html.includes('id="auth-modal"'));
 scripts.forEach(code=>new vm.Script(code));
});
test('guest persistence ignores production records and never writes production keys',()=>{
 const records=new Map([['flowpay_state','{"balance":99999}'],['flowpay_state_user_real-user','{"balance":88888}'],['sb-session','secret-session']]);
 const reads=[],writes=[];
 const storage={getItem:k=>{reads.push(k);return records.get(k)||null},setItem:(k,v)=>{writes.push(k);records.set(k,v)},removeItem:k=>records.delete(k)};
 const nodes={'guest-save-status':{textContent:''}};
 const context=vm.createContext({localStorage:storage,window:{addEventListener(){}},document:{getElementById:id=>nodes[id]},Intl,Number,String,Date,crypto:require('node:crypto').webcrypto,structuredClone,console});
 vm.runInContext(scripts[0],context);
 const core=scripts.find(x=>x.includes('const defaults='));
 vm.runInContext(core,context);
 const runtime=scripts.at(-1).split("document.addEventListener('DOMContentLoaded'")[0];
 vm.runInContext(runtime,context);
 vm.runInContext('load(); save();',context);
 assert.equal(vm.runInContext('state.balance',context),2840);
 vm.runInContext('state.balance=1234; save(); state={}; load();',context);
 assert.equal(vm.runInContext('state.balance',context),1234);
 assert.ok(reads.every(k=>k.startsWith('flowpay_guest_v2:')));
 assert.ok(writes.every(k=>k.startsWith('flowpay_guest_v2:')));
 assert.equal(records.get('flowpay_state_user_real-user'),'{"balance":88888}');
 assert.equal(records.get('sb-session'),'secret-session');
});

