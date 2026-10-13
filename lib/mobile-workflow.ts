// Presentation only: keep data permissions and the system administrator unchanged.
export function usesUnifiedMobile(desktop:boolean,profileRole:string|null|undefined,businessType='SINGLE_RESTAURANT'){
 return !desktop&&profileRole!=='ADMIN'&&businessType==='SINGLE_RESTAURANT';
}
