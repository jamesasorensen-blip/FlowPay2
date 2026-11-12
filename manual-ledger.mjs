export function toggleManualBillPayment(state,key) {
 const index=state.paidOccurrences.findIndex(p=>(typeof p==='string'?p:p.key)===key);
 if(index>=0){
  const paid=state.paidOccurrences[index];
  if(typeof paid==='object')state.balance+=Number(paid.balanceEffect)||0;
  state.paidOccurrences.splice(index,1);
  return 'Bill payment reversed';
 }
 const bill=state.bills.find(b=>String(b.id)===key.split('|')[0]);
 if(!bill||!Number.isFinite(Number(bill.amount))||Number(bill.amount)<=0)throw Error('Bill amount is invalid.');
 const amount=Number(bill.amount);state.balance-=amount;state.paidOccurrences.push({key,balanceEffect:amount});
 return 'Bill paid: '+bill.name;
}

