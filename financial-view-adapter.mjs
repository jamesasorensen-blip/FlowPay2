// Read-only adapter for FlowPay's future reserve and what-if UI.
// Requires explicitly mapped, trusted inputs; does not write or sync financial records.
import {nextMonthBills,reserveProgress,simulateCashFlow} from './cashflow-simulator.mjs';
import {formatMoney} from './financial-display.mjs';
function cents(amount){if(typeof amount!=='number'||!Number.isFinite(amount))throw new TypeError('Expected finite dollar amount');const value=Math.round(amount*100);if(!Number.isSafeInteger(value))throw new RangeError('Amount out of range');return value;}
export function makeNextMonthView({today,bills,reservedDollars=0}){
 if(!Array.isArray(bills))throw new TypeError('Expected bills');
 const normalized=bills.map(b=>({dueDate:b.dueDate,status:b.status,amountCents:cents(b.amountDollars)}));
 const targetCents=nextMonthBills(normalized,today);
 const progress=reserveProgress({targetCents,reservedCents:cents(reservedDollars)});
 return Object.freeze({target:formatMoney(targetCents/100,{kind:'upcoming',status:'estimated'}),reserved:formatMoney(progress.reservedCents/100,{kind:'reserved'}),remaining:formatMoney(progress.remainingCents/100,{kind:'upcoming',status:'estimated'}),percentage:progress.percentage});
}
export function makeScenarioView({startingBalanceDollars,events=[],hypotheticalEvents=[]}){
 const map=(items)=>items.map(e=>({date:e.date,amountCents:cents(e.amountDollars)}));
 const projection=simulateCashFlow({startingBalanceCents:cents(startingBalanceDollars),events:map(events),scenario:map(hypotheticalEvents)});
 return Object.freeze({ending:formatMoney(projection.endingBalanceCents/100,{kind:'simulated',status:'simulated'}),lowest:formatMoney(projection.lowestBalanceCents/100,{kind:'simulated',status:'simulated'}),timeline:projection.timeline.map(e=>Object.freeze({date:e.date,amount:formatMoney(e.amountCents/100,{kind:e.amountCents<0?'expense':'income',status:e.simulated?'simulated':'estimated'}),balance:formatMoney(e.balanceCents/100,{kind:'simulated',status:'simulated'}),simulated:e.simulated}))});
}
