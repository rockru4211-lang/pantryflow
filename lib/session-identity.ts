// This comparison prevents stale responses from ending a newer login. It does
// not authenticate a token; Supabase and server-side policies do that.
export function sameAuthSession(expected:string,current:string|undefined){
 if(expected===current)return true;
 if(!current)return false;
 try{
  const decode=(token:string)=>JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const a=decode(expected),b=decode(current);
  return typeof a.session_id==='string'&&a.session_id.length>0&&a.session_id===b.session_id&&a.sub===b.sub;
 }catch{return false;}
}
