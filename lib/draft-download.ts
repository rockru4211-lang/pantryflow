// A portable rescue copy of current input; importing it must remain an explicit action.
export function downloadDraftRecovery(value:unknown){
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:'beape-draft-recovery',version:1,exportedAt:new Date().toISOString(),value},null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`beape-draft-recovery-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
