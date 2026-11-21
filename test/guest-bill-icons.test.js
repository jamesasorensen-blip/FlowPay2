const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('scripts/guest-bill-controls.txt','utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(0,source.indexOf('function initGuestBillControls()')),context);
const icon=(category,name='',custom='auto')=>context.guestBillIcon({category,name,icon:custom})[0];
test('automatic bill icons cover requested categories and common utility names',()=>{
 for(const [category,id] of Object.entries({'Internet':'internet','Rent':'home','Mortgage':'home','Rent/Utilities':'home','Phone Payment':'phone','Car Payment':'car','Health Insurance':'health','Car Insurance':'insurance','Rental Insurance':'insurance','Student Loan':'student','Medical Bill':'medical','Prescription':'prescription','Credit Card':'credit','Personal Loan':'loan','Gym Membership':'gym','Streaming Service':'stream'}))assert.equal(icon(category),id,category);
 assert.equal(icon('Utilities','Electric bill'),'electric');
 assert.equal(icon('Other','Mobile phone'),'phone');
 assert.equal(icon('Other','Unrecognized bill'),'bill');
});
test('manual choice wins over automatic matching and invalid stored icons fall back safely',()=>{
 assert.equal(icon('Rent','Rent','phone'),'phone');
 assert.equal(icon('Rent','Rent','<img>'),'home');
});
