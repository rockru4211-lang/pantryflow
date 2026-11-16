import type {CountIngredientName} from './ingredient-usage-names.ts';
import {inventoryAccountVerified} from './inventory-cost.ts';
import type {InventoryRow} from './inventory-monthly.ts';
import type {ManagedCodeRow} from './managed-codes.ts';
import {parsePurchaseSpecification} from './purchase-specification.ts';
import {isFreightName,receiptHandling,type ReviewAccount} from './receipt-review.ts';
import {supplierNameKey} from './supplier-prices.ts';

type CountProduct = {product_id:string;name:string;zone?:string;is_removed?:boolean;is_active?:boolean;product_is_active?:boolean|null};
export type CountDisplay = {alias:string;zones:string[]};

export function uniqueItemName(names:(string|null|undefined)[]){
 const distinct=new Map<string,string>();
 for(const value of names){
  const name=value?.trim();
  if(name)distinct.set(name.normalize('NFKC').toLocaleLowerCase(),name);
 }
 return distinct.size===1?[...distinct.values()][0]:'';
}

export function countDisplayByCode(identities:CountIngredientName[],catalog:CountProduct[]){
 const products=new Map<string,CountProduct[]>();
 for(const item of catalog){
  if(item.is_removed||item.is_active===false||item.product_is_active===false)continue;
  const members=products.get(item.product_id)||[];
  members.push(item);
  products.set(item.product_id,members);
 }
 const codes=new Map<string,{aliases:string[];zones:Set<string>}>();
 for(const identity of identities){
  const items=products.get(identity.product_id);
  if(!identity.code||!items?.length)continue;
  const group=codes.get(identity.code)||{aliases:[],zones:new Set<string>()};
  group.aliases.push(identity.count_name||uniqueItemName(items.map(item=>item.name)));
  for(const item of items)if(item.zone)group.zones.add(item.zone);
  codes.set(identity.code,group);
 }
 return new Map([...codes].map(([code,group])=>[code,{
  alias:uniqueItemName(group.aliases),
  zones:[...group.zones],
 }]));
}

export function officialNamesByCode(rows:ManagedCodeRow[],storeId:string){
 const codes=new Map<string,ManagedCodeRow[]>();
 for(const row of rows){
  if(row.kind!=='ingredient'||row.store_id!==storeId||row.inactive||!row.code)continue;
  const names=codes.get(row.code)||[];
  names.push(row);
  codes.set(row.code,names);
 }
 return new Map([...codes].map(([code,items])=>{
  const original=items.filter(row=>row.original_code===code&&!row.canonical_ingredient_id&&!row.target_id);
  return [code,uniqueItemName((original.length?original:items).map(row=>row.name))];
 }));
}

export function distinctCountName(formal:string,alias?:string){
 const value=alias?.trim();
 return value&&value.normalize('NFKC').toLocaleLowerCase()!==formal.trim().normalize('NFKC').toLocaleLowerCase()?value:'';
}

export function stockCategory(category:string|undefined,zones:string[]=[],name=''){
 const kitchen=zones.length&&zones.every(zone=>['食材','內場','料理用'].includes(zone.trim()));
 const wine=/(?:紅酒|白酒|葡萄酒|料理酒|料理用酒|雪莉酒|波特酒|馬德拉酒|tavola ross[oa]|tavola bianc[oa])(?!醋|醬|汁|漬|風味)/i.test(name);
 if(kitchen&&(category==='酒水'||wine&&(!category||['食材','調料','待分類','其他'].includes(category))))return '酒水・料理用';
 return category&&category!=='待分類'?category:'未分類';
}

export function groupStockRows<T>(items:T[],groupOf:(item:T)=>{supplier:string;category:string}){
 const groups=new Map<string,{supplier:string;category:string;items:T[]}>();
 for(const item of items){
  const {supplier,category}=groupOf(item);
  const key=JSON.stringify([supplier,category]);
  const group=groups.get(key)||{supplier,category,items:[]};
  group.items.push(item);
  groups.set(key,group);
 }
 return [...groups.values()].sort((a,b)=>a.supplier.localeCompare(b.supplier,'zh-Hant')||a.category.localeCompare(b.category,'zh-Hant'));
}

const stockMeasureAbbreviations:Record<string,string>={
 g:'g',克:'g',公克:'g',kg:'kg',公斤:'kg',ml:'ml',毫升:'ml',l:'L',公升:'L',斤:'斤',台斤:'台斤',臺斤:'台斤',
};

export function stockPackageSpecification(specification?:string|null,packageUnit?:string|null){
 const original=specification?.trim()||'';
 const [content,statedUnit,...otherParts]=original.split(/[/／]/);
 if(otherParts.length)return original;
 const parsed=parsePurchaseSpecification(content);
 const measure=parsed&&stockMeasureAbbreviations[parsed.unit];
 if(!parsed||!measure)return original;
 const size=`${parsed.quantity}${measure}`;
 if(statedUnit!==undefined)return statedUnit.trim()?`${size}/${statedUnit.trim()}`:original;
 const unit=packageUnit?.trim();
 return unit&&/^(瓶|罐|包|盒|袋|箱|桶|支|顆|個|隻|片|卷|份)$/.test(unit)?`${size}/${unit}`:size;
}

export function stockReceiptLines(accounts:ReviewAccount[]){
 return accounts.filter(inventoryAccountVerified).flatMap(account=>account.lines.filter(line=>
  !!(line.product_id||line.ingredient_id||line.product_code)&&receiptHandling(line)==='NORMAL'&&!isFreightName(line.product_name),
 ).map(line=>({
  batch:account.batch_id,date:account.receipt_date||'',supplier:supplierNameKey(account.supplier_name),
  product:line.product_id,ingredient:line.ingredient_id,code:line.product_code,
  name:line.supplier_item_name?.trim()||line.source_product?.trim()||line.product_name?.trim()||'',
  spec:line.supplier_item_specification?.trim()
   ?stockPackageSpecification(line.supplier_item_specification,line.supplier_item_unit||line.unit)
   :stockPackageSpecification(line.specification,line.unit),
 })));
}

export function stockReceiptDisplay(row:InventoryRow,code:string,ingredientIds:Set<string>|undefined,lines:ReturnType<typeof stockReceiptLines>,suppliers:string[]){
 const linked=lines.filter(line=>!!row.product_id&&line.product===row.product_id||
  !!line.ingredient&&ingredientIds?.has(line.ingredient)||!!code&&line.code===code);
 const batch=row.price_batch_id||row.inventory_cost_quote?.batch_id;
 const fromBatch=batch?linked.filter(line=>line.batch===batch):[];
 const keys=new Set(suppliers.filter(Boolean).map(supplierNameKey));
 const fromSupplier=keys.size?linked.filter(line=>keys.has(line.supplier)):[];
 const latest=fromSupplier.reduce((date,line)=>line.date>date?line.date:date,'');
 const candidates=fromBatch.length?fromBatch:fromSupplier.filter(line=>line.date===latest);
 return {
  name:uniqueItemName(candidates.map(line=>line.name)),
  spec:uniqueItemName(fromBatch.map(line=>line.spec)),
 };
}
