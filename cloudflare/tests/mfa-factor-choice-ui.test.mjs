import test from 'node:test';
import assert from 'node:assert/strict';
import { mountFlowPayMfa } from '../flowpay-mfa-ui.mjs';

class Element {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attrs={};this.events={};this.value='';this.hidden=false;this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,f){this.events[k]=f;}
 async fire(k){await this.events[k]?.({preventDefault(){}});}
}
const find=(node,predicate)=>predicate(node)?node:node.children.map(c=>find(c,predicate)).find(Boolean);
async function setup({single=false,fail=false}={}){
 globalThis.document={createElement:tag=>new Element(tag)};
 const host=new Element('div'),calls=[];
 let factors=[{id:'primary-factor',status:'verified',friendly_name:'Google authenticator'},{id:'backup-factor',status:'verified',friendly_name:'Backup authenticator'}];
 if(single)factors=factors.slice(0,1);
 let level='aal1',user='first-user';
 const supabase={auth:{getSession:async()=>({data:{session:{user:{id:user}}}}),mfa:{
  listFactors:async()=>({data:{totp:factors}}),getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:level}}),
  challenge:async x=>{calls.push(x.factorId);return {data:{id:'challenge'}};},
  verify:async()=>{if(fail)return {error:Error('Invalid code')};level='aal2';return {data:{}};}
 }}};
 const mounted=await mountFlowPayMfa({supabase,host});
 return {host,calls,mounted,select:find(host,e=>e.tag==='select'),input:find(host,e=>e.tag==='input'),form:find(host,e=>e.tag==='form'),button:find(host,e=>e.type==='submit'),reorder:()=>{factors.reverse();},switchUser:()=>{user='second-user';}};
}
test('multiple authenticators require selection and cannot submit the first silently',async()=>{
 const m=await setup();assert.equal(m.select.value,'');assert.equal(m.button.disabled,true);
 m.input.value='123456';await m.form.fire('submit');assert.deepEqual(m.calls,[]);
 assert.match(m.select.children[1].textContent,/Google authenticator/);assert.match(m.select.children[2].textContent,/Backup authenticator/);
});
test('backup selection challenges exactly the selected factor',async()=>{
 const m=await setup();m.select.value='backup-factor';await m.select.fire('change');m.input.value='123456';await m.form.fire('submit');
 assert.deepEqual(m.calls,['backup-factor']);
});
test('selection survives response reordering without switching authenticators',async()=>{
 const m=await setup();m.select.value='backup-factor';await m.select.fire('change');m.reorder();await m.mounted.refresh();assert.equal(m.select.value,'backup-factor');
});
test('failed code retains selected backup rather than retrying another factor',async()=>{
 const m=await setup({fail:true});m.select.value='backup-factor';await m.select.fire('change');m.input.value='123456';await m.form.fire('submit');
 assert.equal(m.select.value,'backup-factor');assert.deepEqual(m.calls,['backup-factor']);assert.equal(m.button.disabled,false);
});
test('one authenticator is selected automatically',async()=>{
 const m=await setup({single:true});assert.equal(m.select.value,'primary-factor');assert.equal(m.button.disabled,false);
});
test('changing accounts clears the previous factor selection',async()=>{
 const m=await setup();m.select.value='backup-factor';await m.select.fire('change');m.switchUser();await m.mounted.refresh();assert.equal(m.select.value,'');assert.equal(m.button.disabled,true);
});
