import type {AppStore} from './app-workspace';
export const dataFeatures=['RECIPE','SUPPLIERS','SPOT'] as const;
// Keep the stored equipment key compatible with older clients; it is now basic work.
export type DataFeature=typeof dataFeatures[number]|'EQUIPMENT';
export type DataAccess=Partial<Record<DataFeature,{view:boolean;edit:boolean}>>;
export const dataFeatureLabels:Record<DataFeature,string>={RECIPE:'食譜',SUPPLIERS:'供應商',SPOT:'抽盤',EQUIPMENT:'設備維修'};
export function officeAccess(store:Pick<AppStore,'role'|'work_functions'>){return store.role==='OWNER'||store.role==='LOGISTICS'&&!!store.work_functions?.includes('OFFICE');}
export function canData(store:Pick<AppStore,'role'|'data_access'|'access_mode'|'work_functions'>,feature:DataFeature,edit=false){
 const basicEquipment=feature==='EQUIPMENT'&&store.work_functions?.some(fn=>fn==='FIELD'||fn==='OFFICE');
 return (!edit||store.access_mode!=='VIEW')&&(store.role==='OWNER'||basicEquipment===true||store.data_access?.[feature]?.[edit?'edit':'view']===true);
}
export function viewAccess(store:AppStore,view:string){
 const feature:Partial<Record<string,DataFeature>>={recipes:'RECIPE',suppliers:'SUPPLIERS','spot-check':'SPOT',equipment:'EQUIPMENT','purchase-notes':'EQUIPMENT'};
 if(['costs','ingredient-prices','code-management','margin-review'].includes(view))return officeAccess(store)&&canData(store,'RECIPE');
 if(['business','members','permissions'].includes(view))return officeAccess(store)||store.can_administer_people===true||store.can_manage_members===true;
 if(feature[view])return canData(store,feature[view]!);
 if(['home','other','count','receiving','receiving-inbox','receiving-issue','transfers','waste','settings','preferences','activity','tasks','notifications'].includes(view))return true;
 return officeAccess(store);
}
