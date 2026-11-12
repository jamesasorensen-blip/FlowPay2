import test from 'node:test';import assert from 'node:assert/strict';
import {nextMonthRange,nextMonthBills,reserveProgress,simulateCashFlow} from '../cashflow-simulator.mjs';
test('December rolls into January',()=>assert.deepEqual(nextMonthRange('2026-12-10'),{start:'2027-01-01',end:'2027-02-01'}));
test('only unpaid next month bills counted',()=>assert.equal(nextMonthBills([{dueDate:'2026-12-01',amountCents:95000},{dueDate:'2026-12-15',amountCents:3000,status:'paid'},{dueDate:'2027-01-01',amountCents:5000}],'2026-11-11'),95000));
test('reserve progress does not move cash',()=>assert.deepEqual(reserveProgress({targetCents:100000,reservedCents:30000}),{targetCents:100000,reservedCents:30000,remainingCents:70000,percentage:30}));
test('what-if changes projection without changing original events',()=>{const events=[{date:'2026-11-13',amountCents:-30000}];const result=simulateCashFlow({startingBalanceCents:100000,events,scenario:[{date:'2026-11-12',amountCents:-20000}]});assert.equal(result.endingBalanceCents,50000);assert.equal(events.length,1);assert.equal(result.timeline[0].simulated,true);});
test('reject fractional cents',()=>assert.throws(()=>simulateCashFlow({startingBalanceCents:0.5})));
