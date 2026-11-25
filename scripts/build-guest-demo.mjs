import {readFileSync, writeFileSync} from 'node:fs';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function replaceOnce(text, from, to) {
  if (!text.includes(from)) throw new Error('Guest build source marker missing: '+from.slice(0,80));
  return text.replace(from,to);
}
const dateRuntime=readFileSync(new URL('./guest-date-format.txt',import.meta.url),'utf8');
let html=source;
html=html.replaceAll('Active Month Bills','Total Remaining Unpaid Bills');
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
${dateRuntime}
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
<div class="flex flex-wrap items-center gap-2"><strong>Guest workspace</strong><span class="text-xs">Try the full manual budgeting tools. No login or bank connection.</span></div>
<p class="text-xs my-2">Sample data on first visit. Enter your own bills, income, balances, and expenses. Stored only in this browser; clearing browser data removes it. <span id="guest-save-status" role="status">No online sync</span></p>
<div class="flex gap-2 flex-wrap"><button type="button" id="guest-empty" class="fp-ui-btn">Start with my own empty budget</button><button type="button" id="guest-sample" class="fp-ui-btn">Restore sample budget</button><button type="button" id="guest-clear" class="fp-ui-btn">Clear guest data</button></div>
</aside>`;
html=html.replace(/(<body[^>]*>)/,'$1'+banner);
html=html.replace('</head>',`<style>
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
html=html.replace('</main>', '<section id="guest-pay-visible-anchor" class="rounded-2xl border border-indigo-300 bg-indigo-50 dark:bg-slate-800 p-4 my-4"><h2 class="font-bold text-lg">Upcoming Paychecks</h2><p class="text-sm">Loading paycheck manager…</p></section></main>');

// Keep the compact next-bill summary identifiable as bills change.
html=replaceOnce(html,"$('fp2-next').textContent=next?money(next.bill.amount):'None';","$('fp2-next').textContent=next?money(next.bill.amount):'None';\n   const nextLabel=$('fp2-next').previousElementSibling;\n   const nextDetail=$('fp2-next').nextElementSibling;\n   nextLabel.replaceChildren(document.createTextNode('Next Bill: '));\n   nextDetail.replaceChildren();\n   if(next){\n    const name=document.createElement('strong');\n    name.textContent=next.bill.name||'Unnamed bill';\n    name.style.color='#2563eb';\n    nextLabel.append(name);\n    const parts=String(next.date).split('-').map(Number);\n    const due=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));\n    const weekdays=['Sun','Mon','Tues','Wed','Thurs','Fri','Sat'];\n    const stamp=String(parts[1]).padStart(2,'0')+'/'+String(parts[2]).padStart(2,'0')+'/'+String(parts[0]).slice(-2);\n    const when=document.createElement('em');\n    when.textContent='('+weekdays[due.getUTCDay()]+', '+stamp+')';\n    when.style.color='#2563eb';\n    nextDetail.append(when);\n   }else nextLabel.append(document.createTextNode('None'));");
html=replaceOnce(html,"category:$('bill-category').value,frequency:","category:$('bill-category').value,icon:$('guest-bill-icon')?.value||'auto',frequency:");
const billControls=readFileSync(new URL('./guest-bill-controls.txt',import.meta.url),'utf8');
html=replaceOnce(html,'</i> Next Month Bills (<span id="included-next-bills-count">0</span>)',`</i> <span class="min-w-0 text-center leading-tight">Include Next Month's Bills <span class="whitespace-nowrap">(<span id="included-next-bills-count">0</span>)</span></span>`);
html=replaceOnce(html,'</i> Buffer ($<span id="buffer-display-val">75</span>)','</i> <span class="min-w-0 text-center leading-tight">Emergency Savings Buffer <span class="whitespace-nowrap">($<span id="buffer-display-val">75</span>)</span></span>');
const shortcuts=readFileSync(new URL('./guest-dashboard-shortcuts.txt',import.meta.url),'utf8');
const runtime=readFileSync(new URL('./guest-workspace-runtime.txt',import.meta.url),'utf8');

 // Separate potential income from currently spendable money; never include received checks.
 html=replaceOnce(html,'id="safe-to-spend-amount">$0.00</div>','id="safe-to-spend-amount">$0.00</div><div id="potential-safe-dashboard" class="hidden mt-2 text-sm text-violet-300"><span>Potential Safe to Spend: </span><strong id="potential-safe-value"></strong><div id="potential-safe-note" class="text-xs mt-1"></div></div>');
 html=replaceOnce(html,'function safeBreakdown(){','function potentialIncomeThrough(end){return (state.paychecks||[]).filter(p=>p.status==="potential"&&p.date>=day()&&(!end||p.date<=end)).reduce((sum,p)=>sum+num(p.amount),0)}\nfunction potentialSafeLabel(value){return (value>0?"↑ +":value<0?"↓ −":"")+money(Math.abs(value))}\nfunction safeBreakdown(){');
 html=replaceOnce(html,"$('safe-to-spend-amount').textContent=money(s.safe);",`$('safe-to-spend-amount').textContent=money(s.safe);const potential=potentialIncomeThrough(),potentialSafe=s.safe+potential;$('potential-safe-dashboard').classList.toggle('hidden',potential<=0);$('potential-safe-value').textContent=potentialSafeLabel(potentialSafe);$('potential-safe-value').className=potentialSafe<0?'text-rose-300':potentialSafe>0?'text-emerald-300':'text-white';$('potential-safe-note').textContent='Includes '+money(potential)+' in upcoming potential paychecks';`);
 html=replaceOnce(html,'<tbody id="paychecks-table-body"','<tbody id="paychecks-table-body"');
 html=replaceOnce(html,"function renderPaychecks(){const tbody=$('paychecks-table-body');",`function renderPaychecks(){const tbody=$('paychecks-table-body');let summary=$('potential-safe-calculator');if(!summary){summary=document.createElement('p');summary.id='potential-safe-calculator';summary.className='text-sm font-semibold my-2';tbody.closest('table').before(summary)}const potential=potentialIncomeThrough(),value=safeBreakdown().safe+potential;summary.hidden=potential<=0;summary.textContent='Potential Safe to Spend: '+potentialSafeLabel(value);summary.style.color=value<0?'#e11d48':value>0?'#059669':'inherit';`);
 html=replaceOnce(html,'for(let i=0;i<offset;i++)grid.append','for(const [eventDate,events] of Object.entries(eventMap))if(eventDate<calendarMonth+"-01")for(const e of events)running+=num(e.amount);for(let i=0;i<offset;i++)grid.append');
 html=replaceOnce(html,'${money(running)}</div>${(eventMap[s]||[])','${money(running)}</div>${s>=start&&potentialIncomeThrough(s)>0?\`<div class="text-[9px] font-semibold ${safeBreakdown().safe+potentialIncomeThrough(s)<0?"text-rose-500":"text-emerald-600"}">Potential safe: ${potentialSafeLabel(safeBreakdown().safe+potentialIncomeThrough(s))}</div>\`:""}${(eventMap[s]||[])');

const paycheckRuntime=readFileSync(new URL('./guest-upcoming-paychecks-runtime.txt',import.meta.url),'utf8');
html=html.replace('</body>', '<script>\n'+runtime+'\n</script>\n<script>\n'+paycheckRuntime+'\n</script>\n<script>\n'+billControls+'\n</script>\n<script>\n'+shortcuts+'\n</script>\n</body>');
// Format only displayed values; stored keys, comparisons and date arithmetic remain ISO.
for(const [from,to] of [
 ["esc(o.date)","esc(guestFormatDate(o.date))"],
 ["esc(p.date)","esc(guestFormatDate(p.date))"],
 ["`Due ${upcoming.date}`","`Due ${guestFormatDate(upcoming.date)}`"],
 ["$('modal-date-title').textContent=s;","$('modal-date-title').textContent=guestFormatDate(s);"],
 ["$('modal-paycheck-date-label').textContent=s;","$('modal-paycheck-date-label').textContent=guestFormatDate(s);"],
 ["labels:p.series.map(x=>x.date)","labels:p.series.map(x=>guestFormatDate(x.date))"],
 ["new Date(a.time).toLocaleString()","guestFormatTimestamp(a.time)"],
 ["new Date(entry.time).toLocaleString()","guestFormatTimestamp(entry.time)"],
 ["tx.name+' · '+tx.date","tx.name+' · '+guestFormatDate(tx.date)"],
 ["meta.textContent=p.date+","meta.textContent=guestFormatDate(p.date)+"],
 ["String(parts[0]).slice(-2)","String(parts[0])"],
 ["const formatDate=s=>{try{return new Date(s+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}catch{return s}};","const formatDate=guestFormatDate;"]
])html=html.replaceAll(from,to);
for(const forbidden of ['supabase.co','workers.dev','cdn.plaid.com','flowpayGetAccessToken','flowpay_session_active','flowpay_user_account','fetch(','XMLHttpRequest','sendBeacon','serviceWorker.register']){
 if(html.includes(forbidden))throw new Error('Guest output contains forbidden integration: '+forbidden);
}
writeFileSync(new URL('../guest-demo.html',import.meta.url),html);
console.log('Built isolated guest workspace from original FlowPay layout.');

