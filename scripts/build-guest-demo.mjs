import {readFileSync, writeFileSync} from 'node:fs';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function replaceOnce(text, from, to) {
  if (!text.includes(from)) throw new Error('Guest build source marker missing: '+from.slice(0,80));
  return text.replace(from,to);
}
let html=source;
const authStart=html.indexOf('<!-- Supabase Auth integration:');
const authEnd=html.indexOf('<!-- End FlowPay Plaid Sandbox -->');
if(authStart<0||authEnd<authStart)throw new Error('Integration boundaries changed');
html=html.slice(0,authStart)+html.slice(authEnd+'<!-- End FlowPay Plaid Sandbox -->'.length);
html=html.replace(/<script src="[^"]*supabase[^"]*"[^>]*><\/script>/g,'');
html=html.replace(/<link rel="manifest"[^>]*>/g,'');
html=html.replace(/<script src="https:\/\/unpkg.com\/lucide@latest"><\/script>/g,'');
html=replaceOnce(html,'<head>',`<head>
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; manifest-src 'none'">
<script>
const guestStorage={
 getItem(key){try{return localStorage.getItem('flowpay_guest_v2:'+key)}catch{return null}},
 setItem(key,value){localStorage.setItem('flowpay_guest_v2:'+key,value)},
 removeItem(key){localStorage.removeItem('flowpay_guest_v2:'+key)}
};
window.flowpayActiveUserId='guest-local-v2';
</script>`);
html=html.replace(/<title>[^<]*<\/title>/,'<title>FlowPay — Guest workspace</title>');
// Remove credential-related code entirely. Guest mode never impersonates a signed-in session.
const credentialStart=html.indexOf('async function hashSecret(');
const credentialEnd=html.indexOf('function monthOptions(',credentialStart);
if(credentialStart<0||credentialEnd<0)throw new Error('Core auth boundaries changed');
html=html.slice(0,credentialStart)+html.slice(credentialEnd);
const initStart=html.indexOf('function init(){');
const navigationStart=html.indexOf("bind('hamburger-menu-btn'",initStart);
if(initStart<0||navigationStart<0)throw new Error('Core init boundaries changed');
html=html.slice(0,initStart)+`function init(){load();theme();monthOptions('bills-month-select',selectedMonth);monthOptions('calendar-month-select',calendarMonth);$('calc-pay-date').value=day();$('bill-due-date').value=day();reorder();
bind('btn-settings','click',()=>openModal('modal-settings'));
`+html.slice(navigationStart);
html=replaceOnce(html,"function load(){try{const x=JSON.parse(localStorage.getItem('flowpay_state')||'{}');", "function load(){try{const x=JSON.parse(guestStorage.getItem('budget')||'null')||guestSample();");
html=replaceOnce(html,"function save(){try{if(window.flowpayActiveUserId)localStorage.setItem('flowpay_state_user_'+window.flowpayActiveUserId,JSON.stringify(state));window.flowpayCloudChanged?.()}catch{toast('Unable to save browser data. Check storage settings.',true)}}", "function save(){try{guestStorage.setItem('budget',JSON.stringify(state));$('guest-save-status').textContent='Saved in this browser only';}catch{ $('guest-save-status').textContent='Not saved — browser storage unavailable';toast('Browser storage is unavailable. Keep this page open or export a backup.',true)}}");
html=replaceOnce(html,"if(storageNotice)storageNotice.textContent='Data is account-scoped; see cloud sync status for details.';$('auth-subtitle').textContent='Local browser account; not cloud-secured.';updateBiometricUI();calcPreview();render()", "if(storageNotice)storageNotice.textContent='Guest workspace — saved only in this browser.';calcPreview();render()");
html=html.replace(/\['↗ Bank transactions',\(\)=>view\('transactions'\)\]/g,"['↗ Manual activity',()=>view('transactions')]");
html=replaceOnce(html,"if(btn)btn.click();else toast('Connect a Sandbox bank to view transactions.',true);","if(btn)btn.click();else {switchPage('guest-activity');renderGuestActivity();}");
html=replaceOnce(html,"['Connect a bank (optional)',()=>{$id('app-sidebar')?.classList.remove('-translate-x-full');$id('sidebar-overlay')?.classList.remove('hidden')}]","['Enter your own starting balance',()=>$id('open-balance-btn')?.click()]");
html=html.replaceAll("label.textContent='Cloud sync enabled'","label.textContent='Local guest workspace'");
html=html.replace('function load(){','function loadGuestBudget(){').replace('function init(){load();','function init(){');
html=html.replace(/localStorage/g,'guestStorage');
// The adapter is the sole direct browser-storage access; all app reads/writes are namespaced.
html=html.replaceAll("return guestStorage.getItem('flowpay_guest_v2:'+key)","return localStorage.getItem('flowpay_guest_v2:'+key)").replaceAll("guestStorage.setItem('flowpay_guest_v2:'+key,value)","localStorage.setItem('flowpay_guest_v2:'+key,value)").replaceAll("guestStorage.removeItem('flowpay_guest_v2:'+key)","localStorage.removeItem('flowpay_guest_v2:'+key)");
html=replaceOnce(html,'<!-- AUTHENTICATION & REGISTRATION MODAL GATE -->','<!-- Guest workspace: no authentication controls -->');
html=html.replace(/<div id="auth-modal"[\s\S]*?(?=    <!--)/,'');
html=html.replace(/<div id="modal-settings"[\s\S]*?(?=    <!-- SAFE TO SPEND)/,`<div id="modal-settings" class="fixed inset-0 bg-slate-950/80 z-[110] hidden items-center justify-center p-4">
<div class="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
<h2 class="font-bold text-lg">Guest workspace settings</h2>
<p class="text-sm">Your entries stay in this browser. They are not encrypted, backed up online, or shared with the FlowPay owner. Anyone using this browser profile can view them. Bank linking and account security require a signed-in account.</p>
<button type="button" id="guest-export" class="fp-ui-btn">Export my guest budget</button>
<button type="button" class="close-modal-btn fp-ui-btn">Close</button>
</div></div>
`);
html=html.replace(/<button id="btn-logout"[\s\S]*?<\/button>/,'');
html=html.replace('aria-label="Account Settings"','aria-label="Guest workspace settings"');
html=replaceOnce(html,'<body', '<body'); // Explicit fail-fast check above remains effective.
const banner=`<aside id="guest-banner" class="px-4 sm:px-8 py-3 bg-indigo-50 dark:bg-slate-800 border-b border-indigo-200 dark:border-slate-700 text-slate-900 dark:text-white">
<div class="flex flex-wrap items-center gap-2"><strong>Guest workspace</strong><a href="/manual.html" class="fp-ui-btn">Sign in to save my budget across devices</a><span class="text-xs">Try the full manual budgeting tools. No login or bank connection.</span></div>
<p class="text-xs my-2">Sample data on first visit. Enter your own bills, income, balances, and expenses. Stored only in this browser; clearing browser data removes it. <span id="guest-save-status" role="status">No online sync</span></p>
<div class="flex gap-2 flex-wrap"><button type="button" id="guest-empty" class="fp-ui-btn">Start with my own empty budget</button><button type="button" id="guest-sample" class="fp-ui-btn">Restore sample budget</button><button type="button" id="guest-clear" class="fp-ui-btn">Clear guest data</button></div>
</aside>`;
html=html.replace(/(<body[^>]*>)/,'$1'+banner);
html=html.replace('</head>',`<style>
#guest-tour-overlay{position:fixed;inset:0;z-index:99999;pointer-events:auto}
#guest-tour-highlight{position:fixed;z-index:1;border:3px solid #a5b4fc;border-radius:14px;box-shadow:0 0 0 9999px rgba(8,15,32,.78);pointer-events:none;transition:all .18s ease}
#guest-tour-card{position:fixed;z-index:2;width:min(370px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:#fff;color:#172033;border-radius:16px;padding:20px;box-shadow:0 12px 50px #0006;font:inherit}
#guest-tour-title{font-size:18px;font-weight:750;margin:8px 0}
#guest-tour-description{font-size:14px;line-height:1.55}
#guest-tour-count{font-size:12px;color:#475569}
#guest-tour-arrow{position:fixed;z-index:3;pointer-events:none;color:#fff;font-size:28px;line-height:1}
.guest-tour-actions{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:18px}
.guest-tour-actions button{border-radius:9px;padding:10px 12px;font-size:13px;cursor:pointer}
#guest-tour-next{background:#4f46e5;color:#fff;font-weight:700}
#guest-tour-skip{color:#334155;text-decoration:underline}
#guest-tour-back{color:#334155;border:1px solid #cbd5e1}
#guest-tour-back:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:380px){.guest-tour-actions{gap:5px}.guest-tour-actions button{padding:9px 7px;font-size:12px}}
#guest-tour-card button:focus-visible{outline:3px solid #818cf8;outline-offset:2px}
@media(prefers-reduced-motion:reduce){#guest-tour-highlight{transition:none}}

header:has(#header-page-title){display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
header:has(#header-page-title)>div:first-child{min-width:0}
header:has(#header-page-title)>div:first-child>button,header:has(#header-page-title)>div:first-child>.w-10{flex-shrink:0}
#header-page-title{overflow-wrap:break-word}
#fp-toolbar{grid-column:1/-1;width:100%;justify-content:flex-start}
#fp4-shortcuts{grid-column:1/-1}
#fp-dock{display:flex!important}
body{padding-bottom:80px}
#modal-settings>div{max-height:85vh;overflow:auto}
@media(max-width:640px){#fp4-shortcuts{display:none}#header-page-title{font-size:16px}header:has(#header-page-title){padding:12px}#fp-toolbar .fp-label{display:inline}#fp-toolbar{gap:7px}#fp2-save-status{white-space:normal}#guest-banner{font-size:12px}}
</style></head>`);
const runtime=readFileSync(new URL('./guest-workspace-runtime.txt',import.meta.url),'utf8');
const tourRuntime=readFileSync(new URL('./guest-tour-runtime.txt',import.meta.url),'utf8');
html=html.replace('</body>', '<script>\n'+runtime+'\n'+tourRuntime+'\n</script>\n</body>');
for(const forbidden of ['supabase.co','workers.dev','cdn.plaid.com','flowpayGetAccessToken','flowpay_session_active','flowpay_user_account','fetch(','XMLHttpRequest','sendBeacon','serviceWorker.register']){
 if(html.includes(forbidden))throw new Error('Guest output contains forbidden integration: '+forbidden);
}
writeFileSync(new URL('../guest-demo.html',import.meta.url),html);
console.log('Built isolated guest workspace from original FlowPay layout.');

