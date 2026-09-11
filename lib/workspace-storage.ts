// Demo drafts live only in this tab's memory. Production drafts retain their
// existing localStorage keys and recovery behavior.
const drafts = new Map<string,string>();
const memory = {getItem:(key:string)=>drafts.get(key)??null,setItem:(key:string,value:string)=>{drafts.set(key,value);},removeItem:(key:string)=>{drafts.delete(key);}};
export function workspaceStorage(userId:string) { return userId.startsWith('demo-user-') ? memory : localStorage; }
export function clearDemoDrafts() { drafts.clear(); }
