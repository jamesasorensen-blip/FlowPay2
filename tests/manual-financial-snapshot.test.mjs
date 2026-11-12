import test from 'node:test';import assert from 'node:assert/strict';import {manualBudgetSnapshot} from '../manual-financial-snapshot.mjs';
test('extracts budget without changing it',()=>{const data=Object.freeze({balance:250,bills:Object.freeze([Object.freeze({id:1,name:'Rent',amount:100})])});assert.deepEqual(manualBudgetSnapshot(data).bills[0],{id:'1',name:'Rent',amountDollars:100,dueDay:null});assert.equal(data.balance,250);});
test('rejects malformed balance',()=>assert.throws(()=>manualBudgetSnapshot({balance:1.001,bills:[]})));
test('skips invalid bill values',()=>assert.equal(manualBudgetSnapshot({balance:0,bills:[{id:1,amount:'not-a-number'}]}).bills.length,0));
