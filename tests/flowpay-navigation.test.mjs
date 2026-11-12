import test from 'node:test';import assert from 'node:assert/strict';
import {SECTIONS,getNavigation,getSection} from '../flowpay-navigation.mjs';
test('mobile keeps main screens and More',()=>assert.deepEqual(getNavigation(390).primary,['home','bills','activity','debt','more']));
test('calendar shopping and settings remain accessible on mobile',()=>assert.deepEqual(getNavigation(390).more,['shopping','calendar','settings']));
test('desktop shows every section',()=>assert.equal(getNavigation(1200).primary.length,SECTIONS.length));
test('breakpoint is deterministic',()=>assert.equal(getNavigation(720).more.length,0));
test('unknown section returns null',()=>assert.equal(getSection('unknown'),null));
test('invalid viewport rejected',()=>assert.throws(()=>getNavigation(-1)));
