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
 const supported=new Set(['monthly','weekly','biweekly','yearly']);
 const sourceBills=Array.isArray(data.bills)?data.bills:[];
 const skippedInvalidAmounts=sourceBills.length-snapshot.bills.length;
 const invalidDueDates=snapshot.bills.filter(b=>!validDate(b.dueDate)).map(b=>b.id);
 const missingBillIds=snapshot.bills.filter(b=>!b.id.trim()).length;
 const idCounts=new Map();for(const b of snapshot.bills)if(b.id.trim())idCounts.set(b.id,(idCounts.get(b.id)||0)+1);
 const duplicateBillIds=[...idCounts].filter(([,count])=>count>1).map(([id])=>id);
 const unsupportedFrequencies=[...new Set(snapshot.bills.map(b=>b.frequency).filter(f=>f&&f!=='once'&&!supported.has(f)))];
 const items=snapshot.bills.flatMap(b=>{
  if(!validDate(b.dueDate))return [];
  const dates=[];
  const anchor=new Date(b.dueDate+'T00:00:00Z');
  const startDate=new Date(start+'T00:00:00Z');
  if(b.frequency==='monthly'){
   const year=startDate.getUTCFullYear(),month=startDate.getUTCMonth();
   const maxDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
   const dueDate=new Date(Date.UTC(year,month,Math.min(anchor.getUTCDate(),maxDay))).toISOString().slice(0,10);
   if(dueDate>=b.dueDate)dates.push(dueDate);
  }else if(b.frequency==='yearly'){
   const year=startDate.getUTCFullYear(),month=anchor.getUTCMonth();
   const maxDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
   const dueDate=new Date(Date.UTC(year,month,Math.min(anchor.getUTCDate(),maxDay))).toISOString().slice(0,10);
   if(dueDate>=b.dueDate&&dueDate>=start&&dueDate<end)dates.push(dueDate);
  }else if(b.frequency==='weekly'||b.frequency==='biweekly'){
   const step=b.frequency==='weekly'?7:14;
   const days=Math.floor((startDate-anchor)/86400000);
   const first=Math.max(0,Math.ceil(days/step));
   for(let n=first;n<first+6;n++){
    const dueDate=new Date(anchor.getTime()+n*step*86400000).toISOString().slice(0,10);
    if(dueDate>=end)break;
    if(dueDate>=start)dates.push(dueDate);
   }
  }else if(b.dueDate>=start&&b.dueDate<end)dates.push(b.dueDate);
  return dates.filter(dueDate=>!paid.has(b.id+'|'+dueDate)).map(dueDate=>Object.freeze({id:b.id,name:b.name,dueDate,amountCents:Math.round(b.amountDollars*100),projected:dueDate!==b.dueDate}));
 });
 items.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const unknownPaidEntries=Array.isArray(data.paidOccurrences)&&data.paidOccurrences.some(p=>{
  const key=typeof p==='string'?p:p&&typeof p.key==='string'?p.key:null;
  if(!key)return true;
  const separator=key.lastIndexOf('|');
  return separator<=0||!validDate(key.slice(separator+1));
 });
 const unique=new Set();
 for(const item of items){const key=item.id+'|'+item.dueDate;if(unique.has(key))throw new Error('Duplicate bill occurrence: '+key);unique.add(key);}
 const targetCents=items.reduce((sum,b)=>{const next=sum+b.amountCents;if(!Number.isSafeInteger(next))throw new RangeError('Bill total exceeds safe limit');return next;},0);
 return Object.freeze({start,end,items:Object.freeze(items),...reserveProgress({targetCents,reservedCents}),scope:'explicit-due-dates-and-supported-recurrence-projections',requiresPaidStatusReview:true,paidOccurrenceKeysApplied:true,unknownPaidEntries,unsupportedFrequencies:Object.freeze(unsupportedFrequencies),requiresScheduleReview:unsupportedFrequencies.length>0||invalidDueDates.length>0||skippedInvalidAmounts>0||unknownPaidEntries||missingBillIds>0||duplicateBillIds.length>0,invalidDueDates:Object.freeze(invalidDueDates),skippedInvalidAmounts,missingBillIds,duplicateBillIds:Object.freeze(duplicateBillIds)});
}
