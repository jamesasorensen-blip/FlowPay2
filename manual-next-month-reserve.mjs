import {manualBudgetSnapshot} from './manual-financial-snapshot.mjs';
import {nextMonthRange,reserveProgress} from './cashflow-simulator.mjs';

// Only explicitly scheduled, unpaid bill occurrences are included. Recurring
// templates are not projected until their recurrence rules are integrated.
export function manualNextMonthReserve(data,today,{reservedCents=0}={}){
 const snapshot=manualBudgetSnapshot(data);
 const {start,end}=nextMonthRange(today);
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 const occurrences=snapshot.bills.filter(b=>validDate(b.dueDate)&&b.dueDate>=start&&b.dueDate<end);
 const items=occurrences.map(b=>Object.freeze({id:b.id,name:b.name,dueDate:b.dueDate,amountCents:Math.round(b.amountDollars*100)}));
 const targetCents=items.reduce((sum,b)=>{const next=sum+b.amountCents;if(!Number.isSafeInteger(next))throw new RangeError('Bill total exceeds safe limit');return next;},0);
 return Object.freeze({start,end,items:Object.freeze(items),...reserveProgress({targetCents,reservedCents}),scope:'explicit-due-dates-only',requiresPaidStatusReview:true});
}
