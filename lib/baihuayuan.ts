import type {AppStore} from './app-workspace';

export const BAIHUAYUAN_NAME = '百花猿';
export const BAIHUAYUAN_BUSINESS_TYPE = 'SINGLE_RESTAURANT' as const;
export const BAIHUAYUAN_STORE_NAMES = ['BeApe','Gras'] as const;

const allowed = new Set<string>(BAIHUAYUAN_STORE_NAMES);

export function isBaihuayuanStoreName(name:string) {
  return allowed.has(name.trim());
}

export function normalizeBaihuayuanStores<T extends AppStore>(stores:T[]):T[] {
  const visible = stores.filter(store => store.is_active !== false && isBaihuayuanStoreName(store.name));
  const linkedStoreCount = visible.length;
  return visible.map(store => ({
    ...store,
    business_type: BAIHUAYUAN_BUSINESS_TYPE,
    has_erp: false,
    store_mode: linkedStoreCount > 1 ? 'MULTI' : 'SINGLE',
    linked_store_count: linkedStoreCount,
  }));
}

export function isBaihuayuanMovement(fromName:string,toName:string) {
  return isBaihuayuanStoreName(fromName) && isBaihuayuanStoreName(toName);
}
