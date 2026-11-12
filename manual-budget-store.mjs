export function createManualBudgetStore({loadRemote,saveRemote,cache,empty,onData=()=>{},onStatus=()=>{},delay=700}) {
 let owner=null,generation=0,revision=0,ready=false,paused=false,dirty=false,conflict=false,data=null,timer=null,writing=null;
 const status=(text)=>onStatus({text,ready,paused,conflict,dirty});
 const snapshot=()=>structuredClone(data);
 function remember(){cache.set(owner,{baseRevision:revision,data:snapshot()});}
 async function open(id){
  close();owner=id;const gen=generation;status('Loading your saved budget…');
  try{
   const remote=await loadRemote(id);if(gen!==generation||id!==owner)return;
   revision=remote?.revision||0;data=remote?.data||empty();const pending=cache.get(id);
   if(pending){
    data=pending.data;dirty=true;
    if(pending.baseRevision!==revision){paused=true;conflict=true;}
   }
   ready=true;onData(snapshot());
   if(conflict)status('Another device changed this budget. Your unsaved local copy is preserved. Export it before loading the account copy.');
   else if(dirty){status('Restoring unsaved changes from this browser…');schedule();}
   else status(revision?'Saved to your account':'Ready — enter your starting balance and bills');
  }catch(error){if(gen!==generation)return;paused=true;status('Could not load your account budget: '+error.message+'. Editing is locked until it loads.');throw error;}
 }
 function close(){generation++;clearTimeout(timer);owner=null;ready=false;paused=false;dirty=false;conflict=false;revision=0;data=null;writing=null;}
 function edit(next){
  if(!ready||!owner)throw Error('Account budget has not loaded.');
  data=structuredClone(next);dirty=true;
  try{remember();}catch{status('Browser recovery storage is unavailable. Keep this page open until the account save succeeds.');}
  if(!paused){status('Saving to your account…');schedule();}
  else status(conflict?'Save conflict — local edits preserved. Export before loading the account copy.':'Not synced — changes are in this browser. Retry saving before closing.');
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>flush(),delay);}
 async function flush(){
  if(writing)return writing;
  if(!owner||!ready||paused||!dirty)return;
  const gen=generation,id=owner;
  const task=(async()=>{
   while(gen===generation&&id===owner&&ready&&!paused&&dirty){
    const sent=snapshot();dirty=false;
    try{
     const next=await saveRemote(id,revision,sent);
     if(gen!==generation||id!==owner)return;
     revision=next;
     if(dirty){try{remember();}catch{}}
     else {try{cache.remove(id);}catch{} status('Saved to your account');}
    }catch(error){
     if(gen!==generation||id!==owner)return;
     dirty=true;paused=true;conflict=error.code==='40001';
     try{remember();}catch{}
     status(conflict?'Save conflict — another device changed this budget. Your local edits are preserved. Export before loading the account copy.':'Not synced: '+error.message+'. Changes remain in this browser. Retry saving.');
    }
   }
  })();
  writing=task;await task;if(gen===generation)writing=null;
 }
 async function retry(){if(conflict)throw Error('Export your unsaved budget, then load the account copy.');if(!ready)return open(owner);paused=false;await flush();}
 async function useCloud(){if(!owner)throw Error('Sign in first.');const id=owner,pending=cache.get(id);if(pending)cache.backup(id,pending);cache.remove(id);await open(id);}
 return {open,close,edit,flush,retry,useCloud,getStatus:()=>({owner,ready,paused,dirty,conflict,revision})};
}

