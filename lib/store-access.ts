export type StoreAccessMode = 'EDIT' | 'VIEW';
export type StoreAccessChoice = StoreAccessMode | 'NONE';
export type StoreAccessRow = {id:string;access_mode?:StoreAccessMode};

// Missing values belong to existing memberships, which keep their old access.
export function storeAccessChoices(stores:StoreAccessRow[]):Record<string,StoreAccessChoice>{
  return Object.fromEntries(stores.map(store=>[store.id,store.access_mode==='VIEW'?'VIEW':'EDIT']));
}

export function changedStoreAccess(manageableIds:string[],before:Record<string,StoreAccessChoice>,after:Record<string,StoreAccessChoice>){
  return [...new Set(manageableIds)].flatMap(store_id=>{
    const previous=before[store_id]||'NONE';
    const access_mode=after[store_id]||'NONE';
    return previous===access_mode?[]:[{store_id,access_mode}];
  });
}

export function loginIdentityStore<T extends {store_code:string;login_identifier?:string|null}>(stores:T[],selected:T,previousStoreCode:string|undefined,pinAccount:boolean):T{
  if(!pinAccount)return selected;
  // A data-store switch must never turn the remembered PIN login into an email login.
  return stores.find(store=>store.store_code===previousStoreCode&&store.login_identifier)
    ||stores.find(store=>store.login_identifier)||selected;
}

export function openingStore<T extends {id:string;is_active?:boolean;default_store_id?:string|null}>(stores:T[],lastStoreId?:string):T|undefined{
 const active=stores.filter(s=>s.is_active!==false);
 return active.find(s=>s.id===lastStoreId)||active.find(s=>s.id===s.default_store_id)||active[0]||stores[0];
}
