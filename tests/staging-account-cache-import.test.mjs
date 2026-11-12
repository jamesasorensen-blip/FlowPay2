import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf("  accountImportButton.addEventListener('click',async () => {");
const end=html.indexOf("  importButton.addEventListener('click',async () => {",start),source=html.slice(start,end);
function harness({exists=false,revision=0,cacheChanged=false,switchAccount=false,cacheChangedDuringWrite=false}={}){
 let handler;const cache=new Map([['account:A',JSON.stringify({balance:500,savingsGoal:200,bills:[],paychecks:[]})],['flowpay_state',JSON.stringify({balance:999999,bills:[{name:'unrelated legacy'}]})]]),reads=[],calls=[],statuses=[],backups=[],usedStates=[];let h;
 const request=async(method,payload)=>{calls.push([method,payload]);if(method==='GET'){if(cacheChanged)cache.set('account:A','changed');if(switchAccount)h.switchTo('B');return {res:{ok:true},body:{exists,revision,data:{balance:123}}};}if(cacheChangedDuringWrite)cache.set('account:A','newer budget');return {res:{ok:true},body:{revision:1}};};
 h=Function('accountImportButton','localStorage','confirm','normalized','request','backup','setStatus','useState','isSample',`let activeId='A',generation=1,paused=true,revision=0,remoteIsSample=false,ready=false,dirty=false;const cacheKey=id=>'account:'+id;${source}return {switchTo(id){activeId=id;generation++;},ready(){return ready;}};`)({disabled:false,addEventListener(_name,cb){handler=cb;}},{getItem:k=>{reads.push(k);return cache.get(k)||null;}},()=>true,data=>({...data}),request,(data,name)=>{calls.push(['BACKUP']);backups.push(data);},msg=>statuses.push(msg),snapshot=>usedStates.push(snapshot),()=>false);
 return {...h,run:()=>handler(),reads,calls,statuses,backups,usedStates};
}
test('account import backs up only the current account before uploading',async()=>{const h=harness();await h.run();assert.equal(h.ready(),true);assert.equal(h.usedStates[0].balance,500);assert.equal(h.calls.map(c=>c[0]).join(','),'GET,BACKUP,PUT');assert.equal(h.backups[0].balance,500);assert.equal(h.calls.at(-1)[1].data.savingsGoal,200);assert.ok(h.reads.every(k=>k==='account:A'));});
for(const [name,opts] of [['existing financial cloud data',{exists:true}],['changed cloud revision',{revision:2}],['changed browser budget',{cacheChanged:true}],['account switch',{switchAccount:true}]])test('account import refuses '+name,async()=>{const h=harness(opts);await h.run();assert.equal(h.calls.filter(c=>c[0]==='PUT').length,0);assert.equal(h.backups.length,0);assert.equal(h.ready(),false);});
test('inline scripts still parse with the separate legacy and account import paths',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new Function(m[1]);});

test('edits made while the cloud write is pending stay in the browser',async()=>{const h=harness({cacheChangedDuringWrite:true});await h.run();assert.equal(h.calls.filter(c=>c[0]==='PUT').length,1);assert.equal(h.ready(),false);assert.equal(h.usedStates.length,0);assert.ok(h.statuses.at(-1).includes('Newer browser records were preserved'));});
