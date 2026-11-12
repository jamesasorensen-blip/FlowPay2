// Conservative receipt text extraction. Never books transactions or guesses from item prices.
export function parseReceiptText(text){
 if(typeof text!=='string'||text.length>20000)throw new TypeError('Receipt text must be under 20,000 characters');
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const candidates=[];
 for(const line of lines){
  const m=line.match(/^(?:grand\s+total|amount\s+due|total\s+(?:due|paid)|total)\s*[:$ ]*\$?\s*(\d{1,7}(?:,\d{3})*|\d{1,7})\.(\d{2})\s*$/i);
  if(m){const amount=Number(m[1].replaceAll(',','')+'.'+m[2]);if(Number.isFinite(amount))candidates.push(amount);}
 }
 const unique=[...new Set(candidates)];
 const dateCandidates=[];
 const addDate=(year,month,day)=>{
  const date=year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0');
  const parsed=new Date(date+'T00:00:00Z');
  if(!Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date)dateCandidates.push(date);
 };
 for(const line of lines){
  // Four-digit years only: two-digit years are ambiguous and require manual review.
  const iso=line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if(iso){addDate(iso[1],iso[2],iso[3]);continue;}
  const us=line.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if(us)addDate(us[3],us[1],us[2]);
 }
 const dates=[...new Set(dateCandidates)];
 return Object.freeze({totalDollars:unique.length===1?unique[0]:null,date:dates.length===1?dates[0]:null,needsReview:true,totalStatus:unique.length===0?'not-found':unique.length===1?'suggested':'ambiguous',dateStatus:dates.length===0?'not-found':dates.length===1?'suggested':'ambiguous'});
}
