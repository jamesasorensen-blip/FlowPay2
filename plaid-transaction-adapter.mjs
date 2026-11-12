// Read-only adapter for Plaid-style transactions. Plaid positive amounts are outflows.
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function mapPlaidTransactions(records){
 if(!Array.isArray(records))throw new TypeError('Transaction records must be an array');
 const ids=new Set();
 // Posted transactions may explicitly link to the pending authorization they replaced.
 const replacedPendingIds=new Set(records.filter(r=>r&&r.pending!==true&&typeof r.pending_transaction_id==='string'&&r.pending_transaction_id.trim()).map(r=>r.pending_transaction_id));
 return records.flatMap(record=>{
  if(!record||typeof record!=='object')return [];
  const id=record.transaction_id;
  const date=record.date;
  const amount=record.amount;
  // Do not treat income, refunds, invalid data, or transactions without stable IDs as spending.
  if(typeof id!=='string'||!id.trim()||ids.has(id)||(record.pending===true&&replacedPendingIds.has(id))||!validDate(date)||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(Math.round(amount*100)))return [];
  ids.add(id);
  return [{id,date,amountDollars:Math.round(amount*100)/100,pending:record.pending===true,merchant:typeof record.merchant_name==='string'?record.merchant_name:typeof record.name==='string'?record.name:''}];
 });
}
