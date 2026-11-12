// Pure cash-flow calculations for next-month bill reserves and what-if scenarios.
// Monetary values are integer cents to avoid floating point drift.
export function asCents(value){if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(value))throw new TypeError('Expected safe integer cents');return value;}
export function nextMonthRange(today){
 const date=new Date(today);if(Number.isNaN(date.getTime()))throw new RangeError('Invalid date');
 const y=date.getUTCFullYear(),m=date.getUTCMonth();
 return {start:new Date(Date.UTC(y,m+1,1)).toISOString().slice(0,10),end:new Date(Date.UTC(y,m+2,1)).toISOString().slice(0,10)};
}
export function nextMonthBills(bills,today){
 const {start,end}=nextMonthRange(today);
 if(!Array.isArray(bills))throw new TypeError('Bills must be an array');
 return bills.filter(b=>b&&b.status!=='paid'&&typeof b.dueDate==='string'&&b.dueDate>=start&&b.dueDate<end)
  .reduce((sum,b)=>sum+asCents(b.amountCents),0);
}
export function reserveProgress({targetCents,reservedCents}){
 const target=asCents(targetCents),reserved=asCents(reservedCents);
 if(target<0||reserved<0)throw new RangeError('Reserve values cannot be negative');
 return {targetCents:target,reservedCents:reserved,remainingCents:Math.max(0,target-reserved),percentage:target===0?100:Math.min(100,Math.round(reserved/target*100))};
}
export function simulateCashFlow({startingBalanceCents,events=[],scenario=[]}){
 let balance=asCents(startingBalanceCents);
 const merged=[...events.map(e=>({...e,simulated:false})),...scenario.map(e=>({...e,simulated:true}))];
 for(const event of merged){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||Number.isNaN(Date.parse(event.date+'T00:00:00Z')))throw new RangeError('Invalid event date');
  asCents(event.amountCents);
 }
 merged.sort((a,b)=>a.date.localeCompare(b.date)||Number(a.simulated)-Number(b.simulated));
 const timeline=merged.map(event=>{balance+=event.amountCents;if(!Number.isSafeInteger(balance))throw new RangeError('Balance overflow');return {date:event.date,balanceCents:balance,simulated:event.simulated,amountCents:event.amountCents};});
 return {endingBalanceCents:balance,lowestBalanceCents:Math.min(startingBalanceCents,...timeline.map(e=>e.balanceCents)),timeline};
}
