import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPasskeyController} from '../manual-mfa.mjs';
test('passkey registration requires the server-confirmed credential ID',async()=>{
 const controller=createPasskeyController({registerPasskey:async()=>({data:null,error:null})});
 await assert.rejects(controller.enroll(),/server did not confirm/);
});
test('saved passkeys are reported from the server',async()=>{
 const controller=createPasskeyController({passkey:{list:async()=>({data:[{id:'saved'}],error:null})},registerPasskey:async()=>({data:{id:'new'},error:null})});
 assert.equal((await controller.list()).length,1);assert.equal((await controller.enroll()).id,'new');
});
test('cancelled device prompts never report registration success',async()=>{
 const controller=createPasskeyController({registerPasskey:async()=>({data:null,error:Error('Request cancelled')})});
 await assert.rejects(controller.enroll(),/cancelled/);
});
const source=readFileSync(new URL('../manual-account.mjs',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function passkeyNotice('),source.indexOf("$('btn-settings').addEventListener('click',refreshPasskeyStatus)"));
function uiContext(list=async()=>[{id:'one'}]){
 const nodes=new Map([['guest-banner',{append(node){node.parentId='guest-banner';nodes.set(node.id,node)}}],['manual-security-status',{textContent:''}],['manual-enroll-passkey',{textContent:''}]]);
 const notices=[];const context=vm.createContext({$:id=>nodes.get(id),document:{createElement:()=>({setAttribute(){}})},toast:(...args)=>notices.push(args),userId:'alice',authGeneration:1,passkeys:{list}});
 vm.runInContext(functions,context);return {context,nodes,notices};
}
test('confirmation remains outside Settings when the device prompt closes it',()=>{
 const h=uiContext();vm.runInContext("passkeyNotice('Passkey registered.')",h.context);
 assert.equal(h.nodes.get('manual-passkey-notice').parentId,'guest-banner');
 assert.equal(h.nodes.get('manual-passkey-notice').textContent,'Passkey registered.');
 assert.equal(h.notices[0][0],'Passkey registered.');
});
test('reopening Settings shows the saved registration count',async()=>{
 const h=uiContext();await vm.runInContext('refreshPasskeyStatus()',h.context);
 assert.match(h.nodes.get('manual-security-status').textContent,/1 saved passkey/);
 assert.equal(h.nodes.get('manual-enroll-passkey').textContent,'Add another fingerprint / passkey');
});
test('a delayed passkey list cannot update another signed-in account',async()=>{
 let finish;const h=uiContext(()=>new Promise(resolve=>finish=resolve));const pending=vm.runInContext('refreshPasskeyStatus()',h.context);
 vm.runInContext("userId='bob';authGeneration++",h.context);h.nodes.get('manual-security-status').textContent='New account';finish([{id:'alice-only'}]);await pending;
 assert.equal(h.nodes.get('manual-security-status').textContent,'New account');
});

