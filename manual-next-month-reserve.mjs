import {manualBudgetSnapshot} from './manual-financial-snapshot.mjs';
import {nextMonthRange,reserveProgress} from './cashflow-simulator.mjs';

// Projects known monthly recurrence; excludes only exact, explicitly paid occurrence keys.
// Unknown payment state remains a review requirement.
export function manualNextMonthReserve(data,today,{reservedCents=0}={}){
 const snapshot=manualBudgetSnapshot(data);
 const {start,end}=nextMonthRange(today);
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 const paid=new Set((Array.isArray(data.paidOccurrences)?data.paidOccurrences:[]).flatMap(p=>{
  const key=typeof p==='string'?p:p&&typeof p.key==='string'?p.key:null;
  return key?[key]:[];
 }));
 const items=snapshot.bills.flatMap(b=>{
  if(!validDate(b.dueDate))return [];
  let dueDate=b.dueDate,projected=false;
  if(b.frequency==='monthly'&&dueDate<start){
   // Calendar-month recurrence; clamp dates such as the 31st to month end.
   const anchor=new Date(b.dueDate+'T00:00:00Z');
   const target=new Date(start+'T00:00:00Z');
   const year=target.getUTCFullYear(),month=target.getUTCMonth(),day=anchor.getUTCDate();
   const maxDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
   dueDate=new Date(Date.UTC(year,month,Math.min(day,maxDay))).toISOString().slice(0,10);
   projected=true;
  }
  if(dueDate<start||dueDate>=end||paid.has(b.id+'|'+dueDate))return [];
  return [Object.freeze({id:b.id,name:b.name,dueDate,amountCents:Math.round(b.amountDollars*100),projected})];
 });
 const unknownPaidEntries=Array.isArray(data.paidOccurrences)&&data.paidOccurrences.some(p=>!(typeof p==='string'||(p&&typeof p.key==='string')));
 const targetCents=items.reduce((sum,b)=>{const next=sum+b.amountCents;if(!Number.isSafeInteger(next))throw new RangeError('Bill total exceeds safe limit');return next;},0);
 return Object.freeze({start,end,items:Object.freeze(items),...reserveProgress({targetCents,reservedCents}),scope:'explicit-due-dates-and-monthly-projections',requiresPaidStatusReview:true,paidOccurrenceKeysApplied:true,unknownPaidEntries});
}
