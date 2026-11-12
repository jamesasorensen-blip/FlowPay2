import test from 'node:test';import assert from 'node:assert/strict';
import {manualNextMonthReserve} from '../manual-next-month-reserve.mjs';
test('includes only bills explicitly due next month',()=>{
 const result=manualNextMonthReserve({balance:500,bills:[{id:1,name:'Rent',amount:900,dueDate:'2026-12-01',frequency:'monthly'},{id:2,name:'Electric',amount:75,dueDate:'2026-11-20'},{id:3,name:'No date',amount:20}]},'2026-11-11',{reservedCents:20000});
 assert.equal(result.targetCents,90000);assert.equal(result.remainingCents,70000);assert.deepEqual(result.items.map(x=>x.id),['1']);assert.equal(result.requiresPaidStatusReview,true);
});
test('projects monthly template into next month',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:20,dueDate:'2026-11-01',frequency:'monthly'}]},'2026-11-11');assert.equal(result.targetCents,2000);assert.equal(result.items[0].dueDate,'2026-12-01');assert.equal(result.items[0].projected,true);});
test('rejects unsafe reserve amounts',()=>assert.throws(()=>manualNextMonthReserve({balance:0,bills:[]},'2026-11-11',{reservedCents:1.5})));

test('clamps a monthly bill due on the 31st to February month end',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:40,dueDate:'2027-01-31',frequency:'monthly'}]},'2027-01-10');assert.equal(result.items[0].dueDate,'2027-02-28');});
test('does not project unsupported recurrence patterns',()=>{const result=manualNextMonthReserve({balance:0,bills:[{amount:40,dueDate:'2026-11-01',frequency:'weekly'}]},'2026-11-11');assert.equal(result.targetCents,0);});

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
