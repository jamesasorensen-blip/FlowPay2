import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const cloud=html.slice(html.indexOf('  const request = async (method, payload) => {'),html.indexOf('\n  const backup =')).trim().replace(/^const request = /,'').replace(/;$/,'');
const bank=html.slice(html.indexOf("  async function api(path, method='GET', payload) {"),html.indexOf('\n  function setBusy(value)')).trim();
const helper=html.slice(html.indexOf('  window.flowpayGetAccessToken = async function'),html.indexOf('\n  const $auth =')).trim();
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=()=>({ok:true,status:200,json:async()=>({success:true})});
function harness(kind,getToken,fetcher){
 const source=kind==='cloud'?'const send = '+cloud+';':'const send = '+bank.replace('async function api(', 'async function(')+';';
 return Function('window','fetch',`let activeId='A',currentUser='A',generation=1;const API='https://mock.invalid';${source}return {send,switchTo(id){activeId=id;currentUser=id;generation++;}};`)({flowpayGetAccessToken:getToken},fetcher);
}
for(const kind of ['cloud','bank']){
 const invoke=h=>kind==='cloud'?h.send('PUT',{revision:1,data:{owner:'A'}}):h.send('/exchange-token','POST',{public_token:'synthetic-A'});
 test(kind+': account switch while token is pending sends no request',async()=>{
  const token=deferred();let calls=0;let expected;
  const h=harness(kind,id=>{expected=id;return token.promise;},async()=>{calls++;return response();});
  const pending=invoke(h);h.switchTo('B');token.resolve('synthetic-B');
  await assert.rejects(pending,/account changed/);assert.equal(calls,0);assert.equal(expected,'A');
 });
 test(kind+': switching away and back still cancels the old request',async()=>{
  const token=deferred();let calls=0;const h=harness(kind,()=>token.promise,async()=>{calls++;return response();});
  const pending=invoke(h);h.switchTo('B');h.switchTo('A');token.resolve('synthetic-A');
  await assert.rejects(pending,/account changed/);assert.equal(calls,0);
 });
 test(kind+': response from prior account is discarded',async()=>{
  const network=deferred();const started=deferred();const h=harness(kind,async()=> 'synthetic-A',async()=>{started.resolve();return network.promise;});
  const pending=invoke(h);await started.promise;h.switchTo('B');network.resolve(response());
  await assert.rejects(pending,/Response discarded/);
 });
 test(kind+': unchanged account completes normally',async()=>{
  let calls=0;const h=harness(kind,async id=>{assert.equal(id,'A');return 'synthetic-A';},async(_url,opts)=>{calls++;assert.equal(opts.headers.Authorization,'Bearer synthetic-A');return response();});
  await invoke(h);assert.equal(calls,1);
 });
}
test('token helper rejects a different session user before request code can use it',async()=>{
 const window={};const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-B',user:{id:'B'}}}})}};
 Function('window','client','activeUser',helper)(window,client,{id:'A'});
 await assert.rejects(window.flowpayGetAccessToken('A'),/account changed/);
});
test('token helper accepts the matching active session',async()=>{
 const window={};const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-A',user:{id:'A'}}}})}};
 Function('window','client','activeUser',helper)(window,client,{id:'A'});
 assert.equal(await window.flowpayGetAccessToken('A'),'synthetic-A');
});
test('old flush completion cannot clear a new generation writing lock',async()=>{
 const flush=html.slice(html.indexOf('  const flush = async () => {'),html.indexOf('\n  const schedule =')).trim().replace(/^const flush = /,'').replace(/;$/,'');
 const pending=deferred();const h=Function('request',`let ready=true,paused=false,writing=false,activeId='A',dirty=true,generation=1,revision=1,state={owner:'A'};const setStatus=()=>{},backup=()=>{},schedule=()=>{};const flush=${flush};return {flush,switch(){generation++;activeId='B';writing=true;},locked(){return writing;}};`)(()=>pending.promise);
 const old=h.flush();h.switch();pending.resolve({res:{ok:true,status:200},body:{revision:2}});await old;assert.equal(h.locked(),true);
});
test('all inline scripts parse',()=>{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new Function(match[1]);
});
