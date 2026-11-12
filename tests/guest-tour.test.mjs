import test from 'node:test';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const build=readFileSync(new URL('../scripts/build-guest-demo.mjs',import.meta.url),'utf8');
const tour=readFileSync(new URL('../scripts/guest-tour-runtime.txt',import.meta.url),'utf8');
test('guest builder embeds isolated guided tour',()=>{
 assert.match(build,/guest-tour-runtime\.txt/);
 assert.match(build,/\+tourRuntime\+/);
 assert.match(build,/#guest-tour-overlay/);
});
test('guided tour is dismissible, replayable, and locally remembered',()=>{
 for(const text of ['tour-complete-v3','guest-tour-next','guest-tour-back','guest-tour-skip','guest-tour-restart','guestStorage.setItem','aria-modal="true"','requestAnimationFrame(position)'])assert.ok(tour.includes(text),text);
});
test('guided tour never mutates budget or invokes financial actions',()=>{
 for(const forbidden of ['guestReset(','state.balance=','state.bills=','fetch(','XMLHttpRequest','form.submit(','\.click('])assert.equal(tour.includes(forbidden),false,forbidden);
});

test('guest tour checks for visible fixed modals before opening',()=>{assert.match(tour,/const modalOpen=/);assert.match(tour,/if\(overlay\|\|modalOpen\(\)\)return/);assert.match(tour,/getComputedStyle\(el\)\.position==='fixed'/);});

test('expanded walkthrough covers every requested dashboard control and menu page',()=>{
 const steps=JSON.parse(tour.match(/const steps=(\[[\s\S]*?\]);\n let index=/)[1]);
 const titles=steps.map(s=>s.title);
 for(const name of ['Quick Add','Settings','Light and dark mode','Bank / manual balance','Safe to spend','Next bill','Next paycheck','Available to Spend Safely','Keep in reserve','Next month bills','Current Balance','Next Upcoming Bill','Active Month Bills','Target Savings Goal','Recurring Bills Schedule','Recent Activity'])assert.ok(titles.includes(name),name);
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const sidebar=source.match(/<aside id="app-sidebar"[\s\S]*?<\/aside>/)[0];
 const pages=[...sidebar.matchAll(/data-page="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(steps.filter(s=>s.menu&&s.selector.includes('data-page')).map(s=>s.selector.match(/data-page="([^"]+)"/)[1]),pages);
 assert.equal(new Set(steps.map(s=>s.selector)).size,steps.length);
});


test('page walkthroughs follow the menu and cover each actual page',()=>{
 const steps=JSON.parse(tour.match(/const steps=(\[[\s\S]*?\]);\n let index=/)[1]);
 const menuEnd=steps.findIndex(s=>s.title==='Close the menu');
 const pages=steps.filter(s=>s.page);
 assert.ok(steps.indexOf(pages[0])>menuEnd);
 assert.deepEqual([...new Set(pages.map(s=>s.page))],['calendar','projection','calculator']);
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const step of pages){
  const id=step.selector.match(/^#([\w-]+)/)[1];
  assert.ok(source.includes('id="'+id+'"')||['fp3-calendar-info','fp-chart-controls','fp3-forecast-info'].includes(id),step.selector);
 }
 for(const id of ['#financial-calendar-grid','#cashFlowChart','#calc-preview-box','#btn-submit-paycheck','#paychecks-table-body'])assert.ok(pages.some(s=>s.selector===id),id);
});

test('tour opens actual app pages once per transition, including Back navigation',()=>{
 const helper=tour.match(/ function previewPage\(page\)\{[\s\S]*?\n \}/)[0];
 const calls=[];
 const context={previewedPage:null,switchPage:page=>calls.push(page)};
 runInNewContext(helper+';previewPage("calendar");previewPage("calendar");previewPage("projection");previewPage("calculator");previewPage("projection");',context);
 assert.deepEqual(calls,['calendar','projection','calculator','projection']);
});
