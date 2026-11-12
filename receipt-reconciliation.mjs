// Receipt reconciliation: matching an uploaded receipt to a bank transaction
// annotates that transaction; it must never create a second expense.
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100));
export function reconcileReceipt(receipt,transactions,{dateToleranceDays=3}={}){
 if(!receipt||!money(receipt.totalDollars)||!validDate(receipt.date))throw new TypeError('Receipt requires valid date and nonnegative total');
 if(!Array.isArray(transactions)||!Number.isInteger(dateToleranceDays)||dateToleranceDays<0||dateToleranceDays>30)throw new TypeError('Invalid transactions or date tolerance');
 const receiptDay=Date.parse(receipt.date+'T00:00:00Z');
 if(Number.isNaN(receiptDay))throw new RangeError('Invalid receipt date');
 const candidates=transactions.filter(t=>{
  if(!t||typeof t.id!=='string'||!t.id.trim()||!money(t.amountDollars)||!validDate(t.date))return false;
  const day=Date.parse(t.date+'T00:00:00Z');
  return Math.round(t.amountDollars*100)===Math.round(receipt.totalDollars*100)&&Math.abs(day-receiptDay)<=dateToleranceDays*86400000;
 });
 return Object.freeze({status:candidates.length===1?'possible-match':candidates.length>1?'ambiguous':'unmatched',matchingTransactionIds:candidates.map(t=>t.id),expenseToAddDollars:0,requiresReview:true});
}
