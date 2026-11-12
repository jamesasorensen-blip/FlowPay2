import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualBudgetStore} from '../manual-budget-store.mjs';
import {toggleManualBillPayment} from '../manual-ledger.mjs';
const pause=()=>new Promise(r=>setTimeout(r,0));
function harness(overrides={}){
 const pending=new Map(),backups=new Map(),statuses=[],views=[],writes=[];
 const cache={get:id=>pending.get(id),set:(id,v)=>pending.set(id,structuredClone(v)),remove:id=>pending.delete(id),backup:(id,v)=>backups.set(id,v)};
 const store=createManualBudgetStore({loadRemote:async()=>({data:{balance:100},revision:1}),saveRemote:async(id,revision,data)=>{writes.push({id,revision,data});return revision+1},cache,empty:()=>({balance:0}),onStatus:x=>statuses.push(x),onData:x=>views.push(x),delay:100000,...overrides});
 return {store,pending,backups,statuses,views,writes};
}
test('budget saves to its owner and returns after the next login',async()=>{
 let remote={data:{balance:100},revision:1};
 const h=harness({loadRemote:async()=>structuredClone(remote),saveRemote:async(id,revision,data)=>{assert.equal(id,'alice');assert.equal(revision,remote.revision);remote={data,revision:revision+1};return remote.revision}});
 await h.store.open('alice');h.store.edit({balance:75});await h.store.flush();assert.equal(h.pending.size,0);
 h.store.close();await h.store.open('alice');assert.equal(h.views.at(-1).balance,75);h.store.close();
});
test('late loads cannot populate a different account',async()=>{
 let resolveA;const h=harness({loadRemote:id=>id==='alice'?new Promise(r=>resolveA=r):Promise.resolve({data:{balance:20},revision:1})});
 const old=h.store.open('alice');await h.store.open('bob');resolveA({data:{balance:999},revision:1});await old;
 assert.equal(h.views.at(-1).balance,20);assert.equal(h.store.getStatus().owner,'bob');h.store.close();
});
test('edits during a save get a second revision and remain recoverable',async()=>{
 let finish;const calls=[];const h=harness({saveRemote:(id,revision,data)=>{calls.push({id,revision,data});return calls.length===1?new Promise(r=>finish=r):Promise.resolve(revision+1)}});
 await h.store.open('alice');h.store.edit({balance:90});const flight=h.store.flush();await pause();h.store.edit({balance:80});finish(2);await flight;
 assert.equal(calls.length,2);assert.equal(calls[1].revision,2);assert.equal(calls[1].data.balance,80);assert.equal(h.pending.size,0);h.store.close();
});
test('offline edits are recovered and can be saved after returning',async()=>{
 const h=harness({saveRemote:async()=>{throw Error('offline')}});
 await h.store.open('alice');h.store.edit({balance:42});await h.store.flush();assert.equal(h.store.getStatus().dirty,true);
 const next=harness();next.pending.set('alice',h.pending.get('alice'));await next.store.open('alice');assert.equal(next.views.at(-1).balance,42);await next.store.flush();assert.equal(next.pending.size,0);h.store.close();next.store.close();
});
test('stale revisions pause saving and preserve a local backup before reload',async()=>{
 const h=harness();h.pending.set('alice',{baseRevision:0,data:{balance:55}});await h.store.open('alice');
 assert.equal(h.store.getStatus().conflict,true);assert.equal(h.views.at(-1).balance,55);await assert.rejects(h.store.retry(),/Export/);
 await h.store.useCloud();assert.equal(h.backups.get('alice').data.balance,55);assert.equal(h.views.at(-1).balance,100);h.store.close();
});
test('late save completion cannot clear another user recovery copy',async()=>{
 let finish;const h=harness({saveRemote:()=>new Promise(r=>finish=r)});
 await h.store.open('alice');h.store.edit({balance:80});const save=h.store.flush();await pause();await h.store.open('bob');h.store.edit({balance:30});finish(2);await save;
 assert.equal(h.pending.get('bob').data.balance,30);assert.equal(h.store.getStatus().owner,'bob');h.store.close();
});
test('paying and undoing a recurring bill adjusts balance exactly once',()=>{
 const s={balance:100,bills:[{id:'rent',name:'Rent',amount:30}],paidOccurrences:[]};
 toggleManualBillPayment(s,'rent|2026-11-20');assert.equal(s.balance,70);assert.equal(s.paidOccurrences.length,1);
 s.bills[0].amount=50;toggleManualBillPayment(s,'rent|2026-11-20');assert.equal(s.balance,100);assert.equal(s.paidOccurrences.length,0);
});
test('reversing an imported legacy paid marker never invents money',()=>{
 const s={balance:100,bills:[{id:'rent',name:'Rent',amount:30}],paidOccurrences:['rent|2026-11-20']};
 toggleManualBillPayment(s,'rent|2026-11-20');assert.equal(s.balance,100);
});

