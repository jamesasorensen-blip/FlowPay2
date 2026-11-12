// Strict, read-only mapping boundary for FlowPay bill records.
// Never guesses a due date, payment status, or currency from ambiguous records.
export function mapBillRecords(records,{amountField='amount',dueDateField='dueDate',statusField='status'}={}){
 if(!Array.isArray(records))throw new TypeError('Bill records must be an array');
 return records.map((record,index)=>{
  if(!record||typeof record!=='object')throw new TypeError('Invalid bill at '+index);
  const amount=record[amountField],dueDate=record[dueDateField],status=record[statusField];
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)throw new RangeError('Invalid bill amount at '+index);
  if(typeof dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||new Date(dueDate+'T00:00:00Z').toISOString().slice(0,10)!==dueDate)throw new RangeError('Invalid due date at '+index);
  if(!['paid','unpaid','pending'].includes(status))throw new RangeError('Unknown payment status at '+index);
  return Object.freeze({amountDollars:amount,dueDate,status});
 });
}
