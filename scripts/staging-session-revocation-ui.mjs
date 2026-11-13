// Opt-in staging test. Tokens stay in this browser's existing SDK session and
// this function's memory; never render, log, export or copy them.
const STAGING_ORIGIN = 'https://flowpay-staging.onrender.com';
const API = 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev';
const TEST_USER = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const PROJECT = 'https://sdiovjwtphqvfjlyoxeq.supabase.co';
const PUBLIC_KEY = 'sb_publishable_rt8itouJe2nsO1wofOqROQ_-6aJ4zlM';

export async function runSessionRevocationTest(client, request = fetch, now = Date.now) {
  let revoked = false;
  try {
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    if (error || session?.user?.id !== TEST_USER || !session?.access_token ||
        !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now() + 120000) {
      return {success:false,message:'Not started: use the dedicated staging test login with at least two minutes remaining on its session token.'};
    }
    const token = session.access_token;
    const check = () => request(API + '/me', {headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(10000)});
    const before = await check();
    const identity = await before.json();
    if (before.status !== 200 || identity.success !== true || identity.user?.id !== TEST_USER) {
      return {success:false,message:'Not started: the staging server did not verify this test login.'};
    }
    const logout = await client.auth.signOut({scope:'local'});
    if (logout.error) return {success:false,message:'Incomplete: session-local sign-out failed.'};
    revoked = true;
    const after = await check();
    const rejection = await after.json();
    if (after.status === 401 && rejection.error === 'SESSION_INVALID' && session.expires_at * 1000 > now()) {
      return {success:true,message:'PASS: the revoked, unexpired Incognito session was rejected. Only this session was signed out.'};
    }
    return {success:false,message:'FAIL: session signed out, but immediate revocation enforcement was not confirmed. Report this result before signing in again.'};
  } catch {
    return {success:false,message:revoked?'Incomplete: session signed out; the follow-up server check failed.':'Not started: the staging session check failed.'};
  }
}

export function installSessionTestPanel(page) {
  if (page.location.origin !== STAGING_ORIGIN || new URL(page.location.href).searchParams.get('session-revocation-test') !== '1') return;
  const doc=page.document;
  const panel=doc.createElement('section');
  panel.id='staging-session-revocation-test';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Staging session revocation test');
  panel.style.cssText='position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#0f172a;color:#f8fafc;padding:clamp(24px,6vw,72px);font:18px/1.6 system-ui';
  panel.innerHTML='<div style="max-width:640px;margin:auto"><p>FLOWPAY · STAGING ONLY</p><h1>Test this Incognito session</h1><p>This signs out only the login in this Incognito window, then checks that the staging server rejects its old session immediately. It does not change your budget or your other browser sessions.</p><p>Wait for ChatGPT to confirm that the staging session check is enabled before starting.</p><label style="display:block;margin:24px 0"><input id="session-test-confirm" type="checkbox"> I am using the separate Incognito test login.</label><button id="session-test-start" disabled style="padding:12px 20px;color:#0f172a;background:#67e8f9;border-radius:10px">Test and sign out this session</button><p id="session-test-result" role="status">Ready. No test has run.</p><button id="session-test-close" style="padding:10px 16px">Close test panel</button></div>';
  doc.body.append(panel);
  const confirm=panel.querySelector('#session-test-confirm'),start=panel.querySelector('#session-test-start'),result=panel.querySelector('#session-test-result'),close=panel.querySelector('#session-test-close');
  let running=false,finished=false;
  confirm.addEventListener('change',()=>{start.disabled=running||finished||!confirm.checked;});
  close.addEventListener('click',()=>{if(!running)panel.remove();});
  start.addEventListener('click',async()=>{
    if(running||finished||!confirm.checked)return;
    running=true;start.disabled=true;close.disabled=true;confirm.disabled=true;result.textContent='Testing this session…';
    let outcome;
    try {
      const client=page.supabase.createClient(PROJECT,PUBLIC_KEY,{auth:{autoRefreshToken:false,detectSessionInUrl:false}});
      try { outcome=await runSessionRevocationTest(client); }
      finally { client.auth.stopAutoRefresh?.(); }
    } catch { outcome={success:false,message:'Not started: authentication library unavailable. Reload this page and retry.'}; }
    running=false;finished=true;close.disabled=false;result.textContent=outcome.message;
  });
}

if (typeof window !== 'undefined') installSessionTestPanel(window);
