import {createMfaController,createPasskeyController} from './manual-mfa.mjs';
import {mountFlowPayMfa} from './manual-mfa-ui.mjs';
import {toggleManualBillPayment} from './manual-ledger.mjs';
import {createManualBudgetStore} from './manual-budget-store.mjs';
if(!window.flowpayManualBridge)await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
const $=id=>document.getElementById(id);
const URL_BASE='https://sdiovjwtphqvfjlyoxeq.supabase.co';
const PUBLIC_KEY='sb_publishable_rt8itouJe2nsO1wofOqROQ_-6aJ4zlM';
const client=window.supabase.createClient(URL_BASE,PUBLIC_KEY,{auth:{storageKey:'flowpay-manual-auth-v1',experimental:{passkey:true},persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const bridge=window.flowpayManualBridge,mfa=createMfaController(client),passkeys=createPasskeyController(client.auth);
let mfaScreenOwner=null;
let userId=null,authGeneration=0,authChecking=false,recheckPending=false,recovery=false,securityView=false;
const message=text=>{$('manual-auth-status').textContent=text;};
const status=text=>{$('guest-save-status').textContent=text;};
const cacheKey=id=>'flowpay_manual_pending_v1:'+id;
const cache={
 get(id){try{const raw=localStorage.getItem(cacheKey(id));return raw?JSON.parse(raw):null;}catch{return null}},
 set(id,value){localStorage.setItem(cacheKey(id),JSON.stringify(value))},
 remove(id){localStorage.removeItem(cacheKey(id))},
 backup(id,value){localStorage.setItem('flowpay_manual_conflict_backup_v1:'+id,JSON.stringify(value));guestStorage.setItem('previous-budget',JSON.stringify(value.data));$('guest-restore').hidden=false}
};
async function tokenFor(owner){
 const {data,error}=await client.auth.getSession();
 if(error)throw error;
 if(data.session?.user?.id!==owner||!data.session.access_token)throw Error('Your sign-in session changed. Sign in again.');
 return data.session.access_token;
}
async function request(owner,path,options={}){
 const token=await tokenFor(owner);
 const response=await fetch(URL_BASE+'/rest/v1/'+path,{...options,headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}});
 const body=await response.json().catch(()=>null);
 if(!response.ok){const error=Error(body?.message||'Account request failed ('+response.status+')');error.code=body?.code;throw error;}
 return body;
}
const store=createManualBudgetStore({
 empty:bridge.empty,cache,
 loadRemote:async owner=>{
  const rows=await request(owner,'manual_budgets?select=owner_id,data,revision&owner_id=eq.'+encodeURIComponent(owner));
  if(!Array.isArray(rows)||rows.length>1)throw Error('Unexpected budget response.');
  if(rows[0]&&rows[0].owner_id!==owner)throw Error('Budget ownership mismatch.');
  return rows[0]||null;
 },
 saveRemote:async(owner,revision,data)=>{
  const next=await request(owner,'rpc/save_manual_budget',{method:'POST',body:JSON.stringify({expected_revision:revision,budget_data:data})});
  if(!Number.isSafeInteger(next)||next<=revision)throw Error('The account save was not confirmed.');
  return next;
 },
 onData:data=>bridge.apply(data),
 onStatus:result=>{
  status(result.text);window.flowpayManualReady=result.ready;$('manual-workspace').inert=!result.ready;
  if(result.ready&&!securityView&&!recovery){$('manual-workspace').hidden=false;$('manual-workspace').inert=false;$('manual-auth').hidden=true;}
  const button=$('manual-use-cloud');if(button)button.hidden=!result.conflict;
 }
});
window.flowpayManualPayBill=toggleManualBillPayment;
window.flowpayManualChanged=data=>{try{store.edit(data)}catch(err){status(err.message)}};
function lock(){
 mfaScreenOwner=null;
 if($('manual-passkey-notice'))$('manual-passkey-notice').textContent='';
 $('manual-security-status').textContent='';
 window.flowpayManualReady=false;bridge.lock();store.close();
 $('manual-workspace').hidden=true;$('manual-workspace').inert=true;$('manual-auth').hidden=false;
}
function loginScreen(text='Sign in to your saved manual budget.'){
 $('manual-auth').hidden=false;$('manual-signin').hidden=false;$('manual-auth-options').hidden=false;
 $('manual-mfa-host').hidden=true;$('manual-mfa-host').replaceChildren();
 $('manual-reset-password').hidden=true;$('manual-auth-signout').hidden=true;$('manual-auth-retry').hidden=false;
 message(text);
}
async function securityScreen(){
 if(mfaScreenOwner===userId&&!$('manual-auth').hidden&&!$('manual-mfa-host').hidden&&$('manual-mfa-host').childElementCount)return;
 mfaScreenOwner=userId;
 $('manual-auth').hidden=false;$('manual-signin').hidden=true;$('manual-auth-options').hidden=true;
 $('manual-mfa-host').hidden=false;$('manual-auth-signout').hidden=false;
 message('Complete authenticator verification to access your financial records.');
 await mountFlowPayMfa({supabase:client,host:$('manual-mfa-host'),onReady:()=>setTimeout(()=>authenticate(),0)});
}
async function authenticate(){
 if(authChecking){recheckPending=true;return;}
 authChecking=true;const generation=authGeneration;
 try{
  const {data,error}=await client.auth.getUser();
  if(generation!==authGeneration)return;
  if(error||!data.user){userId=null;window.flowpayActiveUserId=null;lock();loginScreen(error?'Sign in again to continue.':undefined);return;}
  const id=data.user.id;
  if(userId!==id){lock();userId=id;window.flowpayActiveUserId=id;}
  const security=await mfa.status();if(generation!==authGeneration||id!==userId)return;
  if(security.state!=='ready'){if(window.flowpayManualReady||store.getStatus().owner)lock();window.flowpayActiveUserId=id;await securityScreen();return;}
  if(recovery){$('manual-auth').hidden=false;$('manual-signin').hidden=true;$('manual-auth-options').hidden=true;$('manual-mfa-host').hidden=true;$('manual-reset-password').hidden=false;message('Enter a new password for your account.');return;}
  if(securityView)return;
  if(!store.getStatus().ready)await store.open(id);
 }catch(error){if(generation===authGeneration){message(error.message||'Could not load account.');$('manual-auth-retry').hidden=false;$('manual-auth-signout').hidden=!userId;}}
 finally{authChecking=false;if(recheckPending){recheckPending=false;setTimeout(()=>authenticate(),0);}}
}
async function run(action){
 try{await action();}catch(error){message(error.message||'Authentication failed.');}
}
$('manual-signin').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 message('Signing in…');const {error}=await client.auth.signInWithPassword({email:$('manual-email').value.trim(),password:$('manual-password').value});if(error)throw error;$('manual-password').value='';await authenticate();
})});
$('manual-register').addEventListener('click',()=>run(async()=>{
 if(!$('manual-signin').reportValidity())return;
 message('Creating your account…');
 const {data,error}=await client.auth.signUp({email:$('manual-email').value.trim(),password:$('manual-password').value,options:{emailRedirectTo:location.origin+'/manual.html'}});
 if(error)throw error;$('manual-password').value='';
 if(data.session)await authenticate();else message('Check your email to confirm your account, then sign in and set up your authenticator.');
}));
$('manual-google').addEventListener('click',()=>run(async()=>{
 const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/manual.html'}});if(error)throw error;
}));
$('manual-passkey-signin').addEventListener('click',()=>run(async()=>{
 if(typeof client.auth.signInWithPasskey!=='function')throw Error('Passkey support did not load. Use Google or email sign-in.');
 const {error}=await client.auth.signInWithPasskey();if(error)throw error;await authenticate();
}));
$('manual-forgot').addEventListener('click',()=>run(async()=>{
 const email=$('manual-email').value.trim();if(!email)throw Error('Enter your email address first.');
 const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/manual.html'});if(error)throw error;
 message('If that email has an account, a password-reset link has been sent.');
}));
$('manual-reset-password').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const {error}=await client.auth.updateUser({password:$('manual-new-password').value});if(error)throw error;
 $('manual-new-password').value='';recovery=false;await authenticate();
})});
async function signout(){
 await store.flush();const state=store.getStatus();
 if(state.dirty){status('Some changes are not synced. Export a backup or retry saving before signing out.');throw Error('Your unsaved budget is preserved. Retry saving or export it first.');}
 authGeneration++;userId=null;window.flowpayActiveUserId=null;lock();loginScreen('Signing out…');
 const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;
 loginScreen('Signed out. Sign in again to return to your saved budget.');
}
$('manual-auth-signout').addEventListener('click',()=>run(signout));
$('manual-signout').addEventListener('click',()=>run(signout));
$('manual-auth-retry').addEventListener('click',()=>run(authenticate));
$('manual-retry-save').addEventListener('click',()=>run(async()=>{await store.retry()}));
let passkeyBusy=false;
function passkeyNotice(text,error=false){
 let banner=$('manual-passkey-notice');
 if(!banner){banner=document.createElement('p');banner.id='manual-passkey-notice';banner.setAttribute('role','status');banner.className='text-sm font-semibold mt-3';$('guest-banner').append(banner);}
 banner.textContent=text;
 $('manual-security-status').textContent=text;
 toast(text,error);
}
async function refreshPasskeyStatus(){
 const owner=userId,generation=authGeneration;if(!owner)return;
 const area=$('manual-security-status');area.textContent='Checking saved passkeys…';
 try{
  const rows=await passkeys.list();if(owner!==userId||generation!==authGeneration)return;
  area.textContent=rows.length?rows.length+' saved passkey'+(rows.length===1?'':'s')+' on your account. Fingerprint / passkey sign-in is enabled.':'No passkeys saved yet. Enable one below.';
  $('manual-enroll-passkey').textContent=rows.length?'Add another fingerprint / passkey':'Enable fingerprint / passkey';
 }catch(error){if(owner===userId&&generation===authGeneration)area.textContent='Could not check saved passkeys: '+error.message;}
}
$('btn-settings').addEventListener('click',refreshPasskeyStatus);
$('manual-enroll-passkey').addEventListener('click',async()=>{
 if(passkeyBusy)return;
 passkeyBusy=true;const button=$('manual-enroll-passkey'),owner=userId,generation=authGeneration;button.disabled=true;
 $('manual-security-status').textContent='Waiting for device confirmation…';
 try{
  const security=await mfa.status();if(security.state!=='ready')throw Error('Verify your authenticator first.');
  if(owner!==userId||generation!==authGeneration)return;
  await passkeys.enroll();
  if(owner!==userId||generation!==authGeneration)return;
  passkeyNotice('Passkey registered. Fingerprint / passkey sign-in is now enabled.');
  button.textContent='Add another fingerprint / passkey';
 }catch(error){if(owner===userId&&generation===authGeneration)passkeyNotice(error.message||'Passkey registration could not finish.',true);}
 finally{passkeyBusy=false;button.disabled=false;}
});
$('manual-security-mfa').addEventListener('click',async()=>{
 securityView=true;$('manual-auth').hidden=false;$('manual-signin').hidden=true;$('manual-auth-options').hidden=true;$('manual-mfa-host').hidden=false;
 message('Authenticator settings. Keep a backup authenticator on another device to reduce lockout risk.');
 await mountFlowPayMfa({supabase:client,host:$('manual-mfa-host')});
 const back=document.createElement('button');back.type='button';back.className='fp-ui-btn';back.textContent='Return to budget';
 back.addEventListener('click',()=>{securityView=false;$('manual-auth').hidden=true;back.remove()});$('manual-mfa-host').append(back);
});
const useCloud=document.createElement('button');useCloud.id='manual-use-cloud';useCloud.type='button';useCloud.className='fp-ui-btn';useCloud.hidden=true;useCloud.textContent='Load account copy (keep local backup)';
useCloud.addEventListener('click',()=>run(()=>store.useCloud()));$('manual-retry-save').after(useCloud);
client.auth.onAuthStateChange((event,session)=>{
 if(event==='PASSWORD_RECOVERY')recovery=true;
 if(session&&userId&&session.user.id!==userId){authGeneration++;userId=null;window.flowpayActiveUserId=null;lock();}
 if(!session){authGeneration++;userId=null;window.flowpayActiveUserId=null;lock();}
 setTimeout(()=>authenticate(),0);
});
window.addEventListener('online',()=>{if(store.getStatus().ready&&!store.getStatus().conflict)store.retry().catch(()=>{})});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')store.flush()});
window.addEventListener('beforeunload',event=>{if(store.getStatus().dirty){event.preventDefault();event.returnValue='';}});
loginScreen('Checking your session…');await authenticate();

