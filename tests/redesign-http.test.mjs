import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';

async function freePort(){
 return await new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
 });
}
async function withServer(enabled,fn){
 const port=await freePort();
 const child=spawn(process.execPath,['server.js'],{
  cwd:new URL('../',import.meta.url).pathname,
  env:{...process.env,PORT:String(port),FLOWPAY_ENABLE_REDESIGN_PREVIEW:enabled?'1':'0'},
  stdio:'ignore'
 });
 try{
  let ready=false;
  for(let i=0;i<40;i++){
   if(child.exitCode!==null)throw Error('Server exited before startup');
   try{const res=await fetch(`http://127.0.0.1:${port}/redesign-preview`);if(res.status){ready=true;break;}}catch{}
   await delay(100);
  }
  assert.ok(ready,'Server did not start');
  await fn(`http://127.0.0.1:${port}`);
 }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,2000).unref();});}
}
test('preview is not exposed without explicit opt-in',async()=>{
 await withServer(false,async base=>{
  assert.equal((await fetch(base+'/redesign-preview')).status,404);
  assert.equal((await fetch(base+'/financial-view-adapter.mjs')).status,404);
  assert.equal((await fetch(base+'/')).status,200);
 });
});
test('opted-in preview and dependencies load, private files remain blocked',async()=>{
 await withServer(true,async base=>{
  for(const route of ['/redesign-preview','/design/financial-clarity.css','/financial-view-adapter.mjs','/bill-record-adapter.mjs','/receipt-reconciliation.mjs','/cashflow-simulator.mjs','/financial-display.mjs']){
   const response=await fetch(base+route);assert.equal(response.status,200,route);
  }
  assert.equal((await fetch(base+'/server.js')).status,404);
  assert.equal((await fetch(base+'/package.json')).status,404);
 });
});
