import test from 'node:test';import assert from 'node:assert/strict';
import {manualNextMonthReserve} from '../manual-next-month-reserve.mjs';
test('includes only bills explicitly due next month',()=>{
 const result=manualNextMonthReserve({balance:500,bills:[{id:1,name:'Rent',amount:900,dueDate:'2026-12-01',frequency:'monthly'},{id:2,name:'Electric',amount:75,dueDate:'2026-11-20'},{id:3,name:'No date',amount:20}]},'2026-11-11',{reservedCents:20000});
 assert.equal(result.targetCents,90000);assert.equal(result.remainingCents,70000);assert.deepEqual(result.items.map(x=>x.id),['1']);assert.equal(result.requiresPaidStatusReview,true);
});
test('projects monthly template into next month',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:20,dueDate:'2026-11-01',frequency:'monthly'}]},'2026-11-11');assert.equal(result.targetCents,2000);assert.equal(result.items[0].dueDate,'2026-12-01');assert.equal(result.items[0].projected,true);});
test('rejects unsafe reserve amounts',()=>assert.throws(()=>manualNextMonthReserve({balance:0,bills:[]},'2026-11-11',{reservedCents:1.5})));

test('clamps a monthly bill due on the 31st to February month end',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:40,dueDate:'2027-01-31',frequency:'monthly'}]},'2027-01-10');assert.equal(result.items[0].dueDate,'2027-02-28');});
test('does not project unsupported recurrence patterns',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:40,dueDate:'2026-11-01',frequency:'yearly'}]},'2026-11-11');assert.equal(result.targetCents,0);});

test('excludes an explicitly paid occurrence for the next month',()=>{
 const data={balance:100,bills:[{id:'rent',name:'Rent',amount:950,dueDate:'2026-11-01',frequency:'monthly'}],paidOccurrences:[{key:'rent|2026-12-01',balanceEffect:950}]};
 const result=manualNextMonthReserve(data,'2026-11-11');assert.equal(result.targetCents,0);assert.equal(result.paidOccurrenceKeysApplied,true);
});
test('paid occurrence in current month does not hide next month bill',()=>{
 const data={balance:100,bills:[{id:'rent',amount:950,dueDate:'2026-11-01',frequency:'monthly'}],paidOccurrences:['rent|2026-11-01']};
 assert.equal(manualNextMonthReserve(data,'2026-11-11').targetCents,95000);
});
test('does not treat unrelated paid keys as matching',()=>{
 const data={balance:100,bills:[{id:'rent',amount:950,dueDate:'2026-12-01'}],paidOccurrences:['other|2026-12-01']};
 assert.equal(manualNextMonthReserve(data,'2026-11-11').targetCents,95000);
});

test('flags malformed paid occurrence records for review',()=>{
 const result=manualNextMonthReserve({balance:0,bills:[{id:'rent',amount:100,dueDate:'2026-12-01'}],paidOccurrences:[{bad:'record'}]},'2026-11-11');
 assert.equal(result.targetCents,10000);assert.equal(result.unknownPaidEntries,true);
});

test('rejects duplicate bill occurrences rather than double-counting',()=>{
 const data={balance:100,bills:[{id:'rent',amount:950,dueDate:'2026-12-01'},{id:'rent',amount:950,dueDate:'2026-12-01'}]};
 assert.throws(()=>manualNextMonthReserve(data,'2026-11-11'),/Duplicate bill occurrence/);
});

test('counts every weekly bill occurrence next month',()=>{
 const result=manualNextMonthReserve({balance:0,bills:[{id:'weekly',amount:10,dueDate:'2026-11-30',frequency:'weekly'}]},'2026-11-11');
 assert.deepEqual(result.items.map(x=>x.dueDate),['2026-12-07','2026-12-14','2026-12-21','2026-12-28']);assert.equal(result.targetCents,4000);
});
test('counts biweekly occurrences and excludes only paid occurrence',()=>{
 const result=manualNextMonthReserve({balance:0,bills:[{id:'biweekly',amount:25,dueDate:'2026-11-30',frequency:'biweekly'}],paidOccurrences:['biweekly|2026-12-14']},'2026-11-11');
 assert.deepEqual(result.items.map(x=>x.dueDate),['2026-12-28']);assert.equal(result.targetCents,2500);
});
