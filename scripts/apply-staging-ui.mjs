export function applyStagingUI(source,modules){
function replaceOnce(text,from,to){if(!text.includes(from))throw new Error('Staging UI marker missing: '+from.slice(0,80));return text.replace(from,to)}
let html=source;
html=html.replaceAll('Active Month Bills','Total Remaining Unpaid Bills');
html=html.replace('</head>','<script>\n'+modules['guest-date-format.txt']+'\n</script>\n</head>');
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
@media(max-width:640px){#fp4-shortcuts{display:none}#header-page-title{font-size:16px}header:has(#header-page-title){padding:12px}#fp-toolbar .fp-label{display:inline}#fp-toolbar{gap:7px}#fp2-save-status{white-space:normal}}
</style></head>`);
// Keep the compact next-bill summary identifiable as bills change.
html=replaceOnce(html,"$('fp2-next').textContent=next?money(next.bill.amount):'None';","$('fp2-next').textContent=next?money(next.bill.amount):'None';\n   const nextLabel=$('fp2-next').previousElementSibling;\n   const nextDetail=$('fp2-next').nextElementSibling;\n   nextLabel.replaceChildren(document.createTextNode('Next Bill: '));\n   nextDetail.replaceChildren();\n   if(next){\n    const name=document.createElement('strong');\n    name.textContent=next.bill.name||'Unnamed bill';\n    name.style.color='#2563eb';\n    nextLabel.append(name);\n    const parts=String(next.date).split('-').map(Number);\n    const due=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));\n    const weekdays=['Sun','Mon','Tues','Wed','Thurs','Fri','Sat'];\n    const stamp=String(parts[1]).padStart(2,'0')+'/'+String(parts[2]).padStart(2,'0')+'/'+String(parts[0]).slice(-2);\n    const when=document.createElement('em');\n    when.textContent='('+weekdays[due.getUTCDay()]+', '+stamp+')';\n    when.style.color='#2563eb';\n    nextDetail.append(when);\n   }else nextLabel.append(document.createTextNode('None'));");
html=replaceOnce(html,"category:$('bill-category').value,frequency:","category:$('bill-category').value,icon:$('guest-bill-icon')?.value||'auto',frequency:");
const billControls=modules['guest-bill-controls.txt'];
html=replaceOnce(html,'</i> Next Month Bills (<span id="included-next-bills-count">0</span>)',`</i> <span class="min-w-0 text-center leading-tight">Include Next Month's Bills: <span class="whitespace-nowrap">(<span id="included-next-bills-count">0</span>)</span></span>`);
html=replaceOnce(html,'</i> Buffer ($<span id="buffer-display-val">75</span>)','</i> <span class="min-w-0 text-center leading-tight">Emergency Savings Buffer: <span class="whitespace-nowrap">($<span id="buffer-display-val">75</span>)</span></span>');
const shortcuts=modules['guest-dashboard-shortcuts.txt'];


 // Separate potential income from currently spendable money; never include received checks.
 html=replaceOnce(html,'id="safe-to-spend-amount">$0.00</div>','id="safe-to-spend-amount">$0.00</div><div id="potential-safe-dashboard" class="hidden mt-2 text-sm text-violet-300"><span>Potential Safe to Spend: </span><strong id="potential-safe-value"></strong><div id="potential-safe-note" class="text-xs mt-1"></div></div>');
 html=replaceOnce(html,'function safeBreakdown(){','function potentialIncomeThrough(end){return (state.paychecks||[]).filter(p=>p.status==="potential"&&p.date>=day()&&(!end||p.date<=end)).reduce((sum,p)=>sum+num(p.amount),0)}\nfunction potentialSafeLabel(value){return (value>0?"↑ +":value<0?"↓ −":"")+money(Math.abs(value))}\nfunction safeBreakdown(){');
 html=replaceOnce(html,"$('safe-to-spend-amount').textContent=money(s.safe);",`$('safe-to-spend-amount').textContent=money(s.safe);const potential=potentialIncomeThrough(),potentialSafe=s.safe+potential;$('potential-safe-dashboard').classList.toggle('hidden',potential<=0);$('potential-safe-value').textContent=potentialSafeLabel(potentialSafe);$('potential-safe-value').className=potentialSafe<0?'text-rose-300':potentialSafe>0?'text-emerald-300':'text-white';$('potential-safe-note').textContent='Includes '+money(potential)+' in upcoming potential paychecks';`);
 html=replaceOnce(html,'<tbody id="paychecks-table-body"','<tbody id="paychecks-table-body"');
 html=replaceOnce(html,"function renderPaychecks(){const tbody=$('paychecks-table-body');",`function renderPaychecks(){const tbody=$('paychecks-table-body');let summary=$('potential-safe-calculator');if(!summary){summary=document.createElement('p');summary.id='potential-safe-calculator';summary.className='text-sm font-semibold my-2';tbody.closest('table').before(summary)}const potential=potentialIncomeThrough(),value=safeBreakdown().safe+potential;summary.hidden=potential<=0;summary.textContent='Potential Safe to Spend: '+potentialSafeLabel(value);summary.style.color=value<0?'#e11d48':value>0?'#059669':'inherit';`);
 html=replaceOnce(html,'for(let i=0;i<offset;i++)grid.append','for(const [eventDate,events] of Object.entries(eventMap))if(eventDate<calendarMonth+"-01")for(const e of events)running+=num(e.amount);for(let i=0;i<offset;i++)grid.append');
 html=replaceOnce(html,'${money(running)}</div>${(eventMap[s]||[])','${money(running)}</div>${s>=start&&potentialIncomeThrough(s)>0?\`<div class="text-[9px] font-semibold ${safeBreakdown().safe+potentialIncomeThrough(s)<0?"text-rose-500":"text-emerald-600"}">Potential safe: ${potentialSafeLabel(safeBreakdown().safe+potentialIncomeThrough(s))}</div>\`:""}${(eventMap[s]||[])');

const paycheckRuntime=modules['guest-upcoming-paychecks-runtime.txt'];
html=html.replace('</body>', '<script>\n'+paycheckRuntime+'\n</script>\n<script>\n'+billControls+'\n</script>\n<script>\n'+shortcuts+'\n</script>\n</body>');
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

return html;
}
