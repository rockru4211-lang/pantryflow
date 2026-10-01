import type {InventoryRow} from './inventory-monthly';
import type {SpotCheck,SpotItem,SpotList} from './spot-checks';

export type InventorySpot={check_id:string;zone_id:string;zone:string;quantity:number|null;baseline:number|null;difference:number|null;note:string;status:string;created_at:string};
type Rpc=<T>(action:string,data:Record<string,string>)=>Promise<T>;
/** Reuse the authorized spot-check API; never combine separate trials or units. */
export async function readInventorySpots(rpc:Rpc,storeId:string,sourceId:string,month:string){
 const list=await rpc<SpotList>('list',{month:month.slice(0,7)});
 if(!Array.isArray(list.checks))throw Error('INVALID_SPOT_RESPONSE');
 const checks=list.checks.filter(c=>c.store_id===storeId&&c.source_id===sourceId&&c.status!=='DRAFT');
 const details:SpotCheck[]=[];
 // Bound concurrency so a month with many checks does not flood the connection.
 for(let start=0;start<checks.length;start+=3){
  details.push(...await Promise.all(checks.slice(start,start+3).map(async c=>{
   const detail=await rpc<SpotCheck>('detail',{id:c.id});
   if(detail.id!==c.id||detail.store_id!==storeId||detail.source_id!==sourceId||!Array.isArray(detail.items))throw Error('INVALID_SPOT_RESPONSE');
   return detail;
  })));
 }
 return details;
}
export function inventorySpots(rows:InventoryRow[],checks:SpotCheck[],storeId:string,sourceId:string):InventoryRow[]{
 const latest=new Map<string,{check:SpotCheck;item:SpotItem}>();
 for(const check of [...checks].filter(c=>c.store_id===storeId&&c.source_id===sourceId&&c.status!=='DRAFT').sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))){
  for(const item of check.items){
   const key=JSON.stringify([item.product_id,item.unit,item.zone_id]);
   if(!latest.has(key))latest.set(key,{check,item});
  }
 }
 return rows.map(row=>({...row,spots:[...latest.values()].filter(({item})=>item.product_id===row.product_id&&item.unit===row.unit).map(({check,item})=>{
  const quantity=item.quantity==null?null:Number(item.quantity),baseline=item.original_quantity==null?null:Number(item.original_quantity);
  return {check_id:check.id,zone_id:item.zone_id,zone:item.zone,quantity,baseline,difference:quantity===null||baseline===null?null:Number((quantity-baseline).toFixed(3)),note:item.note||'',status:check.status,created_at:check.created_at};
 }).sort((a,b)=>a.zone.localeCompare(b.zone,'zh-TW'))}));
}
