import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {chooseMfaFactor} from '../manual-mfa.mjs';
import {mountFlowPayMfa} from '../manual-mfa-ui.mjs';
const factors=[{id:'primary-123',friendly_name:'FlowPay authenticator',status:'verified',created_at:'2026-11-09'},{id:'backup-456',friendly_name:'FlowPay backup authenticator',status:'verified',created_at:'2026-11-10'}];
test('multiple authenticators require an explicit choice without a remembered preference',()=>{
 assert.equal(chooseMfaFactor(factors),'');assert.equal(chooseMfaFactor([...factors].reverse()),'');
 assert.equal(chooseMfaFactor(factors,'','backup-456'),'backup-456');
 assert.equal(chooseMfaFactor([...factors].reverse(),'primary-123','backup-456'),'primary-123');
});
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.style={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
 async fire(name){for(const fn of this.events[name]||[])await fn({preventDefault(){}});}
}
async function harness(t,{fail=false,prefs=null}={}){
 const oldDoc=globalThis.document,oldStorage=globalThis.localStorage;const nodes=[],saved=new Map(prefs?[['flowpay_mfa_choice_v1:alice',JSON.stringify(prefs)]]:[]);
 globalThis.document={createElement:tag=>{const n=new Element(tag);nodes.push(n);return n},createTextNode:text=>({textContent:text})};
 globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 t.after(()=>{globalThis.document=oldDoc;globalThis.localStorage=oldStorage});
 let level='aal1',reversed=false;const calls=[];let ready=0;
 const auth={getSession:async()=>({data:{session:{user:{id:'alice'}}}}),signOut:async()=>({}),mfa:{
 listFactors:async()=>({data:{totp:reversed?[...factors].reverse():factors}}),
 getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:level,nextLevel:'aal2'}}),
 challenge:async x=>{calls.push(['challenge',x.factorId]);return {data:{id:'challenge'}}},
 verify:async x=>{calls.push(['verify',x.factorId]);if(fail){const error=Error('Bad code');error.code='mfa_verification_failed';return {error}}level='aal2';return {data:{}}},
 }};
 const mounted=await mountFlowPayMfa({supabase:{auth},host:new Element('host'),onReady:()=>ready++});
 return {nodes,saved,calls,mounted,ready:()=>ready,reverse:()=>reversed=true,selector:nodes.find(n=>n.attrs['aria-label']==='Choose authenticator'),input:nodes.find(n=>n.attrs['aria-label']==='Authenticator code'),alias:nodes.find(n=>n.attrs['aria-label']==='Authenticator name'),form:nodes.find(n=>n.tag==='form'),message:nodes.find(n=>n.attrs.role==='status')};
}
test('only the explicitly selected backup receives a challenge and verification',async t=>{
 const h=await harness(t);assert.equal(h.selector.value,'');
 h.selector.value='backup-456';await h.selector.fire('change');h.alias.value='Microsoft Authenticator';h.input.value='123456';await h.form.fire('submit');
 assert.deepEqual(h.calls,[['challenge','backup-456'],['verify','backup-456']]);assert.equal(h.ready(),1);
 const prefs=JSON.parse(h.saved.get('flowpay_mfa_choice_v1:alice'));assert.equal(prefs.preferredId,'backup-456');assert.equal(prefs.aliases['backup-456'],'Microsoft Authenticator');
});
test('refreshes and server ordering changes preserve the selected authenticator',async t=>{
 const h=await harness(t);h.selector.value='primary-123';await h.selector.fire('change');h.reverse();await h.mounted.refresh();assert.equal(h.selector.value,'primary-123');
});
test('a rejected code retains the chosen factor and never tries the other automatically',async t=>{
 const h=await harness(t,{fail:true});h.selector.value='primary-123';await h.selector.fire('change');h.input.value='123456';await h.form.fire('submit');
 assert.deepEqual(h.calls,[['challenge','primary-123'],['verify','primary-123']]);assert.equal(h.selector.value,'primary-123');assert.match(h.message.textContent,/Code not accepted for FlowPay authenticator/);assert.equal(h.ready(),0);assert.equal(h.input.value,'');
});
test('remembered authenticator names remain tied to factor IDs after ordering changes',async t=>{
 const h=await harness(t,{prefs:{preferredId:'backup-456',aliases:{'backup-456':'Microsoft Authenticator','primary-123':'Google Authenticator'}}});
 assert.equal(h.selector.value,'backup-456');assert.equal(h.alias.value,'Microsoft Authenticator');h.reverse();await h.mounted.refresh();assert.equal(h.selector.value,'backup-456');
 assert.ok(h.selector.children.some(n=>n.textContent.startsWith('Google Authenticator')));
});
test('auth session rechecks do not remount an in-progress MFA screen',async()=>{
 const source=readFileSync(new URL('../manual-account.mjs',import.meta.url),'utf8');const code=source.slice(source.indexOf('async function securityScreen(){'),source.indexOf('async function authenticate(){'));
 const nodes=new Map(['manual-auth','manual-signin','manual-auth-options','manual-mfa-host','manual-auth-signout'].map(id=>[id,{hidden:true,childElementCount:0}]));
 let mounts=0;const context=vm.createContext({$:id=>nodes.get(id),userId:'alice',mfaScreenOwner:null,message(){},mountFlowPayMfa:async({host})=>{mounts++;host.childElementCount=1},client:{},setTimeout(){},authenticate(){}});
 vm.runInContext(code,context);await vm.runInContext('securityScreen()',context);await vm.runInContext('securityScreen()',context);assert.equal(mounts,1);
});

