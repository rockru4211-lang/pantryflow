import {changedStoreAccess,storeAccessChoices,type StoreAccessMode,type StoreAccessChoice} from './store-access';

export type PersonStore={id:string;name:string;store_code:string;role:string;login_identifier:string;uses_pin:boolean;access_mode?:StoreAccessMode;extra_permissions?:string[]};
export type Person={can_edit_functions?:boolean;work_functions?:WorkFunction[];default_store_id?:string|null;user_id:string;display_name:string;company_member:boolean;company_title:string|null;is_owner:boolean;role:string;stores:PersonStore[];revision:string;can_manage_access:boolean;can_edit_profile:boolean;can_grant_export:boolean;access_store_ids:string[];allowed_titles:string[]};
export type PeopleStore={id:string;name:string;store_code:string};
export type PersonDraft={name:string;title:string;access:Record<string,StoreAccessChoice>;exportMode:'KEEP'|'ALLOW'|'REMOVE'};

export function personTitle(person:Person):string{
 if(person.is_owner)return '老闆';
 if(person.company_member)return person.company_title||'行政';
 const roles=[...new Set(person.stores.map(s=>s.role))];
 if(roles.length>1)return '依各店設定';
 return (roles[0]||person.role)==='SUPERVISOR'?'主管':'員工';
}
export function personDraft(person:Person):PersonDraft{
 return {name:person.display_name,title:personTitle(person),access:storeAccessChoices(person.stores),exportMode:'KEEP'};
}
export function personChanges(person:Person,draft:PersonDraft){
 const profile=person.can_edit_profile&&(draft.name.trim()!==person.display_name||draft.title!==personTitle(person)||draft.exportMode!=='KEEP')
  ?{display_name:draft.name.trim(),title:draft.title,export_mode:draft.exportMode}:null;
 const access=person.can_manage_access?changedStoreAccess(person.access_store_ids,storeAccessChoices(person.stores),draft.access):[];
 return {profile,access};
}
export function hasPersonChanges(person:Person,draft:PersonDraft){const changes=personChanges(person,draft);return !!changes.profile||changes.access.length>0;}
export function filterPeople(people:Person[],query:string,storeId:string){
 const q=query.trim().toLocaleLowerCase();
 return people.filter(p=>(storeId==='ALL'||p.stores.some(s=>s.id===storeId))&&(!q||p.display_name.toLocaleLowerCase().includes(q)))
  .sort((a,b)=>Number(b.is_owner)-Number(a.is_owner)||a.display_name.localeCompare(b.display_name,'zh-TW'));
}

export type WorkFunction='FIELD'|'OFFICE'|'MANAGE';
export const functionLabels:Record<WorkFunction,string>={FIELD:'現場作業',OFFICE:'行政作業',MANAGE:'人員與系統管理'};
export function workFunctions(person:Person):WorkFunction[]{return person.work_functions||(['FIELD',...(['OWNER','LOGISTICS'].includes(person.role)?['OFFICE']:[]),...(person.is_owner?['MANAGE']:[])] as WorkFunction[]);}
