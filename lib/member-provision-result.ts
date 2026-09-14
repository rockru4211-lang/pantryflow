/** An invitation is deliberately pending; it does not have a staff membership yet. */
export function memberProvisionSucceeded(role:string,data:{staffId?:string;inviteId?:string;invited?:boolean;pending?:boolean;login?:unknown}|null){
  return Boolean(data?.staffId&&(role==='STAFF'||data.login)) || (role!=='STAFF' && Boolean(data?.inviteId&&(data.invited||data.pending)));
}
