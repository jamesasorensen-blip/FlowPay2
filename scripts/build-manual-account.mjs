import { readFileSync,writeFileSync } from 'node:fs';
import './build-guest-demo.mjs';
let html=readFileSync(new URL('../guest-demo.html',import.meta.url),'utf8');
html=html.replace('<title>FlowPay — Guest workspace</title>','<title>FlowPay — Manual account</title>');
html=html.replace("script-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net","script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net").replace("connect-src 'none'","connect-src https://sdiovjwtphqvfjlyoxeq.supabase.co");
const start=html.indexOf('const guestStorage={'),end=html.indexOf('</script>',start);
if(start<0||end<0)throw Error('Guest adapter boundary changed');
html=html.slice(0,start)+`window.flowpayManualReady=false;
window.flowpayActiveUserId=null;
const guestStorage={
 key(key){if(!window.flowpayActiveUserId)throw Error('Sign in first');return 'flowpay_manual_v1:'+window.flowpayActiveUserId+':'+key},
 getItem(key){try{return localStorage.getItem(this.key(key))}catch{return null}},
 setItem(key,value){localStorage.setItem(this.key(key),value)},
 removeItem(key){localStorage.removeItem(this.key(key))}
};
`+html.slice(end);
html=html.replace('</head>','<style>#manual-auth[hidden],#manual-workspace[hidden],#manual-mfa-host[hidden],#manual-signin[hidden],#manual-auth-options[hidden],#manual-reset-password[hidden]{display:none!important}</style></head>');
html=html.replace(/(<body[^>]*>)/,'$1'+`<section id="manual-auth" class="fixed inset-0 z-[200] bg-slate-100 dark:bg-slate-950 overflow-auto p-5 flex items-start justify-center">
<div class="w-full max-w-md my-8 bg-white text-slate-900 rounded-2xl shadow-xl p-6 space-y-4">
<h1 class="text-2xl font-bold">FlowPay manual account</h1><p class="text-sm">Your bills, income, expenses, and forecasts, saved privately to your account. No bank connection required.</p>
<p id="manual-auth-status" role="status" class="text-sm text-indigo-700">Connecting securely…</p>
<form id="manual-signin" class="space-y-3"><label class="block">Email<input id="manual-email" type="email" autocomplete="username webauthn" required class="w-full border rounded-xl p-3"></label><label class="block">Password<input id="manual-password" type="password" autocomplete="current-password" minlength="8" required class="w-full border rounded-xl p-3"></label>
<button type="submit" class="fp-ui-btn fp-primary">Sign in</button><button id="manual-register" type="button" class="fp-ui-btn">Create account</button></form>
<div id="manual-auth-options" class="flex flex-wrap gap-2"><button id="manual-google" class="fp-ui-btn" type="button">Continue with Google</button><button id="manual-passkey-signin" class="fp-ui-btn" type="button">Fingerprint / passkey sign-in</button><button id="manual-forgot" class="fp-ui-btn" type="button">Forgot password</button></div>
<p class="text-xs">Fingerprint sign-in uses a passkey verified by the authentication server. Your device may offer fingerprint, face, PIN, or a security key. Complete authenticator verification when requested.</p>
<div id="manual-mfa-host" hidden></div>
<form id="manual-reset-password" hidden class="space-y-3"><label>New password<input id="manual-new-password" type="password" autocomplete="new-password" minlength="8" required class="w-full border rounded-xl p-3"></label><button type="submit" class="fp-ui-btn fp-primary">Save new password</button></form>
<button id="manual-auth-retry" type="button" class="fp-ui-btn" hidden>Retry account check</button>
<button id="manual-auth-signout" type="button" class="fp-ui-btn" hidden>Sign out</button>
</div></section><div id="manual-workspace" hidden inert>`);
html=html.replace('<a href="/manual.html" class="fp-ui-btn">Sign in to save my budget across devices</a>','');
html=html.replace('Guest workspace</strong>','Manual account</strong>').replace('Try the full manual budgeting tools. No login or bank connection.','Your own budget, saved to your account. No bank connection.');
html=html.replace('Sample data on first visit. Enter your own bills, income, balances, and expenses. Stored only in this browser; clearing browser data removes it.','Enter your own bills, income, balances, and expenses. Check the save status before closing the app. A recovery copy is also kept in this browser.');
html=html.replace('No online sync','Loading account…');
html=html.replace('Guest workspace settings','Manual account settings');
html=html.replace('Your entries stay in this browser. They are not encrypted, backed up online, or shared with the FlowPay owner. Anyone using this browser profile can view them. Bank linking and account security require a signed-in account.','Your budget is private to your signed-in account and protected by authenticator verification. A recovery copy stays in this browser profile; anyone who can use this profile may access that copy. Export a backup before clearing browser data.');
html=html.replace('Export my guest budget','Export my budget');
html=html.replace('Guest workspace — saved only in this browser.','Account-backed manual budget. No bank connection.');
html=html.replace("label.textContent='Local guest workspace'","label.textContent='Manual account'");
html=html.replace("function save(){try{guestStorage.setItem('budget',JSON.stringify(state));$('guest-save-status').textContent='Saved in this browser only';}catch{ $('guest-save-status').textContent='Not saved — browser storage unavailable';toast('Browser storage is unavailable. Keep this page open or export a backup.',true)}}",
"function save(){if(!window.flowpayManualReady){toast('Wait until your account finishes loading.',true);return}window.flowpayManualChanged?.(structuredClone(state));}");
const runtimeStart=html.lastIndexOf('<script>');
if(runtimeStart<0)throw Error('Guest runtime boundary changed');
html=html.slice(0,runtimeStart)+readFileSync(new URL('./manual-workspace-runtime.txt',import.meta.url),'utf8')+'\n</div>\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/dist/umd/supabase.js"></script>\n<script type="module" src="/manual-account.mjs"></script>\n</body></html>';
for(const forbidden of ['workers.dev','cdn.plaid.com','flowpayGetAccessToken','flowpay_user_account','flowpay_session_active'])if(html.includes(forbidden))throw Error('Manual output contains legacy integration '+forbidden);
writeFileSync(new URL('../manual.html',import.meta.url),html);
console.log('Built signed-in manual account workspace.');

