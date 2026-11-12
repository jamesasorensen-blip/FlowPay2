import test from 'node:test';import assert from 'node:assert/strict';import {parseReceiptText} from '../receipt-text-parser.mjs';
test('suggests labeled total and ISO date',()=>assert.deepEqual(parseReceiptText('MILK 4.00\nTAX 0.25\nTOTAL $4.25\n2026-11-11'),{totalDollars:4.25,date:'2026-11-11',needsReview:true,totalStatus:'suggested',dateStatus:'suggested'}));
test('does not confuse subtotal or tax with total',()=>assert.equal(parseReceiptText('SUBTOTAL 15.00\nTAX 1.00').totalDollars,null));
test('conflicting totals require review',()=>assert.equal(parseReceiptText('TOTAL 10.00\nTOTAL 11.00').totalStatus,'ambiguous'));
test('no amount guessed from items',()=>assert.equal(parseReceiptText('Bread $3.50\nMilk $4.50').totalDollars,null));

test('reads US month/day/four-digit-year dates',()=>assert.equal(parseReceiptText('TOTAL $13.97\n11/11/2026').date,'2026-11-11'));
test('rejects impossible US dates',()=>assert.equal(parseReceiptText('TOTAL $13.97\n02/30/2026').date,null));
test('does not guess ambiguous two-digit years',()=>assert.equal(parseReceiptText('TOTAL $13.97\n11/11/26').date,null));
test('conflicting dates require review',()=>assert.equal(parseReceiptText('11/11/2026\n2026-11-12\nTOTAL $13.97').dateStatus,'ambiguous'));
