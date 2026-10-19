// A display/login hint only. Never persist PINs, tokens or device authorization here.
export const rememberedPersonKey='beape:remembered-login-person';
export function readRememberedPerson(storage:Storage=localStorage):string {
  try {const value=storage.getItem(rememberedPersonKey)||'';return value.length<=64?value:'';} catch {return '';}
}
export function rememberPerson(identifier:string|null,storage:Storage=localStorage):void {
  try {if(identifier?.trim()&&identifier.trim().length<=64)storage.setItem(rememberedPersonKey,identifier.trim());else storage.removeItem(rememberedPersonKey);} catch {/* Login works when browser storage is unavailable. */}
}
