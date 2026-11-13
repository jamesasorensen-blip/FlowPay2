import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runSessionRevocationTest,installSessionTestPanel } from '../scripts/staging-session-revocation-ui.mjs';
const id='0b2cf21b-5147-4337-b73d-fbba9f1a514d',now=1800000000000;
function setup({user=id,expiry=now/1000+600,before=200,after=401,error='SESSION_INVALID',logoutError=null}={}){
 const calls=[],signouts=[];
 const session={user:{id:user},expires_at:expiry,access_token:'test-token-only'};
 const client={auth:{getSession:async()=>({data:{session}}),signOut:async args=>{signouts.push(args);return {error:logoutError};}}};
 const request=async(url,init)=>{calls.push({url,init});return calls.length===1?Response.json({success:true,user:{id}},{status:before}):Response.json({error},{status:after});};
 return {client,request,calls,signouts};
}
test('revokes only local session and reuses its token solely for the fixed staging check',async()=>{
 const m=setup();const r=await runSessionRevocationTest(m.client,m.request,()=>now);
 assert.equal(r.success,true);assert.deepEqual(m.signouts,[{scope:'local'}]);assert.equal(m.calls.length,2);
 for(const c of m.calls){assert.equal(c.url,'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev/me');assert.equal(c.init.headers.Authorization,'Bearer test-token-only');assert.equal(c.init.redirect,'manual');assert.ok(c.init.signal);}
 assert.doesNotMatch(r.message,/test-token-only/);
});
test('foreign account and near-expiry token stop without signing out',async()=>{
 for(const options of [{user:'foreign'},{expiry:now/1000+30}]){const m=setup(options);assert.equal((await runSessionRevocationTest(m.client,m.request,()=>now)).success,false);assert.equal(m.calls.length,0);assert.equal(m.signouts.length,0);}
});
test('failed server identity check stops before logout',async()=>{
 const m=setup({before:401});assert.equal((await runSessionRevocationTest(m.client,m.request,()=>now)).success,false);assert.equal(m.signouts.length,0);
});
test('logout error never claims successful revocation',async()=>{
 const m=setup({logoutError:Error('private')});assert.equal((await runSessionRevocationTest(m.client,m.request,()=>now)).success,false);assert.equal(m.calls.length,1);
});
test('accepted tokens and generic auth failures cannot pass',async()=>{
 for(const options of [{after:200},{error:'Unauthorized'}]){const m=setup(options);assert.equal((await runSessionRevocationTest(m.client,m.request,()=>now)).success,false);}
});
test('expiry and network errors cannot masquerade as revocation',async()=>{
 const m=setup();let n=0;assert.equal((await runSessionRevocationTest(m.client,m.request,()=>n++?now+9999999:now)).success,false);
 assert.equal((await runSessionRevocationTest(m.client,async()=>{throw Error('test-token-only');},()=>now)).message,'Not started: the staging session check failed.');
});
test('panel is absent on production and without explicit test query',()=>{
 const blocked=()=>{throw Error('DOM accessed');};
 for(const url of ['https://flowpay-6aay.onrender.com/?session-revocation-test=1','https://flowpay-staging.onrender.com/'])installSessionTestPanel({location:new URL(url),get document(){return blocked();}});
});
test('embedded staging module exactly matches its reviewed source',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=fs.readFileSync(new URL('../scripts/staging-session-revocation-ui.mjs',import.meta.url),'utf8');
 assert.ok(html.includes('<script type="module" id="staging-session-revocation-module">\n'+source+'\n</script>'));
 assert.equal((html.match(/id="staging-session-revocation-module"/g)||[]).length,1);
});
