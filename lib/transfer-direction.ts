export type TransferStore = {id: string; name: string};
export type TransferDirection = {id: string; label: string; from_store_id: string; to_store_id: string};
export type TransferProduct = {id: string; name: string; unit: string; available_for_transfer?: boolean};
export type TransferCatalog = {store_id: string; products: TransferProduct[]};

/** Use server-scoped, active store IDs, never a hardcoded production ID. */
export function transferDirections(current: TransferStore, peers: TransferStore[]): TransferDirection[] {
  if (!['BeApe', 'Gras'].includes(current.name)) return [];
  const stores = [...new Map([current, ...peers].map(store => [store.id, store])).values()];
  const first = stores.filter(store => store.name === 'BeApe');
  const second = stores.filter(store => store.name === 'Gras');
  if (first.length !== 1 || second.length !== 1 || first[0].id === second[0].id) return [];
  return [
    {id: 'beape-to-gras', label: '一店 BeApe → 二店 Gras', from_store_id: first[0].id, to_store_id: second[0].id},
    {id: 'gras-to-beape', label: '二店 Gras → 一店 BeApe', from_store_id: second[0].id, to_store_id: first[0].id},
  ];
}

/** A legacy saved outbound draft has no source property; a new blank draft stays unselected. */
export function selectedTransferDirection(
  directions: TransferDirection[],
  draft: {from_store_id?: string; to_store_id?: string},
  recordingStoreId: string,
): TransferDirection | undefined {
  const from = draft.from_store_id === undefined && draft.to_store_id ? recordingStoreId : draft.from_store_id;
  return directions.find(direction => direction.from_store_id === from && direction.to_store_id === draft.to_store_id);
}

/** Source-only metadata. Do not fall back to the receiving store's catalog. */
export function sourceTransferProducts(catalogs: TransferCatalog[] | undefined, sourceId: string | undefined): TransferProduct[] {
  if (!sourceId) return [];
  return (catalogs?.find(catalog => catalog.store_id === sourceId)?.products || [])
    .filter(product => product.available_for_transfer !== false);
}
