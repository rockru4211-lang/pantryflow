import type {AppStore} from './app-workspace';

export type ReadOnlySection='stock'|'counts'|'receipts'|'transfers'|'waste';
export function readOnlyStorePolicy(store:Pick<AppStore,'role'|'permissions'>&{company_title?:string|null}) {
  return {
    blind:store.role==='STAFF',
    confirmedOnly:store.company_title==='財務',
    reports:store.permissions?.reports_view??store.role!=='STAFF',
    export:store.permissions?.data_export??store.role!=='STAFF',
  };
}
export function visibleReviewedRows<T extends {review_status?:string}>(rows:T[],confirmedOnly:boolean):T[] {
  return confirmedOnly?rows.filter(row=>row.review_status==='CONFIRMED'):rows;
}
export function readOnlyMonthRange(month:string) {
  const [year,number]=month.split('-').map(Number);
  return {from:`${month}-01T00:00:00+08:00`,to:`${number===12?year+1:year}-${String(number===12?1:number+1).padStart(2,'0')}-01T00:00:00+08:00`};
}
