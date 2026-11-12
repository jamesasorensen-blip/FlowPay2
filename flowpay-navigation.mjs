// Accessible, opt-in navigation for the FlowPay redesign.
// Does not alter the existing application's navigation until explicitly mounted.
export const SECTIONS=Object.freeze([
 {id:'home',label:'Home',description:'Your money at a glance'},
 {id:'bills',label:'Bills',description:'Payments and reserves'},
 {id:'activity',label:'Activity',description:'Transactions and receipts'},
 {id:'debt',label:'Debt',description:'Credit and borrowing'},
 {id:'shopping',label:'Shopping',description:'Plan and review purchases'},
 {id:'calendar',label:'Calendar',description:'Upcoming cash flow'},
 {id:'settings',label:'Settings',description:'Preferences and privacy'}
]);
const PRIMARY=['home','bills','activity','debt'];
export function getNavigation(viewportWidth){
 if(!Number.isFinite(viewportWidth)||viewportWidth<0)throw new RangeError('Invalid width');
 return viewportWidth<720
  ? {primary:[...PRIMARY,'more'],more:['shopping','calendar','settings']}
  : {primary:SECTIONS.map(x=>x.id),more:[]};
}
export function getSection(id){return SECTIONS.find(x=>x.id===id)??null;}
export function mountNavigation(root,{initial='home',onNavigate=()=>{},width=()=>window.innerWidth}={}){
 if(!(root instanceof HTMLElement))throw new TypeError('Navigation root must be an HTMLElement');
 if(!getSection(initial))throw new RangeError('Unknown initial section');
 let active=initial;
 const doc=root.ownerDocument;
 const nav=doc.createElement('nav');
 nav.setAttribute('aria-label','FlowPay sections');
 nav.className='fp-navigation';
 const more=doc.createElement('div');more.className='fp-more-menu';more.hidden=true;
 function makeButton(id){
  const button=doc.createElement('button');button.type='button';
  button.className='fp-nav-button';
  button.textContent=id==='more'?'More':getSection(id).label;
  button.dataset.section=id;
  if(id===active)button.setAttribute('aria-current','page');
  button.addEventListener('click',()=>{
   if(id==='more'){more.hidden=!more.hidden;button.setAttribute('aria-expanded',String(!more.hidden));return;}
   active=id;more.hidden=true;render();onNavigate(id);
  });
  return button;
 }
 function render(){
  const layout=getNavigation(width());
  nav.replaceChildren(...layout.primary.map(makeButton));
  more.replaceChildren(...layout.more.map(makeButton));
  more.hidden=true;
  root.replaceChildren(nav,more);
 }
 render();
 return {navigate(id){if(!getSection(id))throw new RangeError('Unknown section');active=id;render();onNavigate(id);},getActive:()=>active,refresh:render,destroy(){root.replaceChildren();}};
}
