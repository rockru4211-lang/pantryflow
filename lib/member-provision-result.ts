/** An invitation is deliberately pending; it does not have a staff membership yet. */
export function memberProvisionSucceeded(role:string,data:{staffId?:string;inviteId?:string;invited?:boolean;pending?:boolean}|null){
  return role==='STAFF'?Boolean(data?.staffId):Boolean(data?.inviteId&&(data.invited||data.pending));
}
