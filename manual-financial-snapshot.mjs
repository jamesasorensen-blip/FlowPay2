// Read-only snapshot for the redesigned UI. Never mutates the manual budget or persists changes.
export function manualBudgetSnapshot(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new TypeError('Budget must be an object');
 const money=v=>typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<1e-7;
 const balance=data.balance;
 if(!money(balance))throw new TypeError('Budget balance must be a valid monetary amount');
 const bills=Array.isArray(data.bills)?data.bills:[];
 const normalized=bills.flatMap(b=>{
  if(!b||typeof b!=='object'||!money(Number(b.amount))||Number(b.amount)<0)return [];
  return [{id:String(b.id??''),name:String(b.name??''),amountDollars:Number(b.amount),dueDay:b.dueDay??b.day??null}];
 });
 return Object.freeze({balanceDollars:balance,bills:Object.freeze(normalized.map(b=>Object.freeze(b))),source:'authenticated-manual-budget',readOnly:true});
}
