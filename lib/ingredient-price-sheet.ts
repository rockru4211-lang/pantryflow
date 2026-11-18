import {ingredientDraft,ingredientSourcePriority,formatPurchaseSpecification,usesPackageSpecification,ingredientPurchase,type IngredientMaster,type IngredientSource,type IngredientDraft} from './ingredient-catalog.ts';
import {recipeFactor,recipeUnit,type RecipePurchase} from './recipe-model.ts';
import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
import {isFreightName} from './receipt-review.ts';
import {supplierNameIndex,supplierNameKey} from './supplier-prices.ts';
import {supplierCategory} from './supplier-categories.ts';
export type SupplyState={ingredient_id:string;supplier_key:string;supplier_name:string;replacement?:string;stopped:boolean;reason:string;disposition:string;note:string;revision:number;updated_at:string};
export type SupplyEvent={id:string;ingredient_id:string;supplier_key:string;supplier_name:string;action:'stop'|'restore'|'note';replacement?:string;reason:string;disposition:string;note:string;created_at:string;actor_id:string;actor_name?:string;snapshot:IngredientMaster};
export type PriceIngredient=IngredientMaster&{current_quote?:CostQuote|null;category?:string|null;price_date?:string|null;supplier_id?:string|null;supplier_name?:string;supplier_key?:string;sources?:PriceSource[];dismissed_reference?:string;dismissed_value?:number;sheet_receipt_label?:{name:string;supplier_key:string}|null;original_display_code?:string|null};
export type PriceSource=IngredientSource&{supplier_key:string;supplier_name:string;created_at?:string;can_apply?:boolean;receipt_price?:number|null;receipt_unit?:string|null;receipt_purchase?:RecipePurchase|null;receipt_supplier?:string|null};
export type StandardHistory={id:string;ingredient_id:string;effective_date:string;reason:string;actor_name:string;snapshot:IngredientMaster;previous_snapshot?:IngredientMaster|null;supplier_key?:string|null;previous_supplier_key?:string|null;supplier_name?:string|null;created_at:string};
export type SheetClassification={archived:boolean;reason:string;revision:number};
export type PendingSupplierSource={group:BaselineGroup;row:PriceIngredient;source:PriceSource;original:string};
export type PriceSheetData={sheet_classifications?:Record<string,SheetClassification>;sheet_source_suppliers?:Record<string,string>;price_history?:StandardHistory[];ingredients:PriceIngredient[];can_price:boolean;supply_states:SupplyState[];supply_events:SupplyEvent[];suppliers:{id:string;name:string;active:boolean}[]};
export const emptyPriceSheet:PriceSheetData={ingredients:[],can_price:false,supply_states:[],supply_events:[],suppliers:[]};
export function isIngredientStopped(row:IngredientMaster,states:SupplyState[]){return states.some(s=>(s.ingredient_id===row.id||s.ingredient_id===row.canonical_ingredient_id)&&s.supplier_key==='*'&&s.stopped);}
export function priceCandidate(row:PriceIngredient,states:SupplyState[]){
 if(isIngredientStopped(row,states))return null;
 const q=(row.sources||[]).filter(q=>q.can_apply!==false&&q.review_status==='confirmed'&&q.source_kind==='purchase'&&q.price!==null&&q.unit===row.unit&&(!row.effective_date||!!q.effective_date&&q.effective_date>=row.effective_date)&&!states.some(s=>s.ingredient_id===row.id&&s.supplier_key===q.supplier_key&&s.stopped)).sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')||(b.created_at||'').localeCompare(a.created_at||''))[0];
 return q&&q.id!==row.selected_reference&&q.price!==row.cost_price&&!(row.dismissed_reference===q.id&&row.dismissed_value===q.price)?q:null;
}
export function supplierOptions(row:PriceIngredient){const m=new Map<string,string>();if(row.supplier_key)m.set(row.supplier_key,row.supplier_name||'未命名供應商');for(const s of row.sources||[])if(s.supplier_key)m.set(s.supplier_key,s.supplier_name||'未命名供應商');return [...m].map(([key,name])=>({key,name}));}
export function ingredientSupplierNames(row:PriceIngredient){return [row.supplier_name,row.current_quote?.supplier_name,...(row.sources||[]).flatMap(source=>[source.receipt_supplier,source.supplier_name])].filter((name):name is string=>!!name);}
export function priceSearch(row:PriceIngredient,term:string,includeSuppliers=true){return [row.canonical_code,row.ingredient_code,row.original_display_code,row.name,row.sheet_receipt_label?.name,row.count_name,...(includeSuppliers?ingredientSupplierNames(row):[]),...(row.recipe_aliases||[]),...row.aliases.map(a=>a.name)].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export function candidatePurchase(q:PriceSource){return ingredientPurchase({purchase:q.purchase})||{amount:q.price,unit:q.unit};}
export const priceCategories=['食材','耗材','調料','酒水','待分類'];
export const baselineCategory=(row?:PriceIngredient)=>priceCategories.includes(row?.category||'')?row!.category!:'待分類';
export const baselinePriceDate=(row:PriceIngredient)=>row.price_date!==undefined?row.price_date||'':row.manual?'':row.effective_date||'';
export const priceEdit=(row?:PriceIngredient)=>({...ingredientDraft(row),category:baselineCategory(row),effective_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:'供應商調價',supplier_id:row?.supplier_id||(row?.supplier_key?.startsWith('id:')?row.supplier_key.slice(3):'')||''});

export function currentIngredientPurchase(row:PriceIngredient,receipts:IngredientReceiptPrice[],supplier=''){
 const quote=row.current_quote;
 const receipt=receipts.find(r=>!supplier||r.supplier===supplier);
 if(quote?.basis==='locked')return {purchase:originalIngredientPurchase(quote.purchase),supplier:quote.supplier_name||row.supplier_name,date:quote.date,source:'鎖定進價',reason:quote.reason};
 const receiptQuote=quote?.basis==='receipt'?originalIngredientPurchase(quote.purchase):null;
 if(receiptQuote&&(!supplier||quote?.supplier_name===supplier)&&(!receipt||(quote?.date||'')>=receipt.date))
  return {purchase:receiptQuote,supplier:quote?.supplier_name||row.supplier_name,date:quote?.date,source:quote?.source,reason:quote?.reason};
 if(receipt)return {purchase:receipt.purchase,supplier:receipt.supplier,date:receipt.date,source:'已確認建檔進貨'};
 const reference=ingredientReferencePrice(row,supplier);
 if(reference&&!row.manual&&quote?.basis!=='receipt'
  &&(!quote?.reason||quote.reason==='缺少已確認進價或單位換算')
  &&(!quote||quote.price==null||quote.basis==='standard'))return reference;
 const quotePurchase=quote&&(quote.price!=null||quote.basis==='receipt')?originalIngredientPurchase(quote.purchase):null;
 if(quotePurchase&&(!supplier||quote?.supplier_name===supplier)){
  return {purchase:quotePurchase,supplier:quote?.supplier_name||row.supplier_name,date:quote?.date,source:quote?.source,reason:quote?.reason};
 }
 const legacyPrice=supplier&&supplier!==(quote?.supplier_name||row.supplier_name)?null:quote?.price??(row.current_quote===undefined?row.cost_price:null);
 const fallback=(!supplier||supplier===row.supplier_name)&&row.review_status==='confirmed'
  &&!(quote?.basis==='receipt'&&quote.price===null)?originalIngredientPurchase(row.purchase):null;
 const purchase=fallback||(legacyPrice!=null?originalIngredientPurchase({amount:legacyPrice,quantity:1,unit:quote?.unit||row.unit}):null);
 return {purchase,supplier:quote?.supplier_name||row.supplier_name,date:quote?.date||(purchase?baselinePriceDate(row):null),source:quote?.source||(purchase?row.manual?'標準價':referencePriceLabel(row)||'已確認價格':''),reason:quote?.reason};
}

/** Metadata edits must not turn an imported price into a manual baseline. */
export function priceSavePreservesBaseline(edit:PriceSheetEdit){
 if(!edit.row)return false;
 const original=edit.initialDraft||priceEdit(edit.row);
 return (['price','unit','reference','specification','content','contentUnit','effective_date','change_reason'] as const).every(field=>edit.draft[field]===original[field]);
}

export type PriceSheetEdit={row?:PriceIngredient;draft:IngredientDraft&{supplier_id:string;category?:string};requestId:string;recipeAlias?:string;aliasRequestId?:string;metadataSaved?:boolean;single?:boolean;supplierKey?:string;initialDraft?:IngredientDraft&{supplier_id:string;category?:string}};

// Prefer persisted canonical links; legacy display groups keep original IDs and prices intact.
export const baselineName=(name:string)=>name.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim().replace(/\s+/gu,' ');
const normalizedName=(name:string)=>baselineName(name).toLocaleLowerCase();
export function baselineSourceRank(source?:string,kind?:string){
 return ingredientSourcePriority(source,kind);
}
export function baselineSources(row:PriceIngredient){return [...(row.sources||[])].sort((a,b)=>baselineSourceRank(a.source,a.source_kind)-baselineSourceRank(b.source,b.source_kind)||(b.effective_date||'').localeCompare(a.effective_date||'')||a.id.localeCompare(b.id));}
export function baselinePurchaseDate(row:PriceIngredient){return [row,...(row.sources||[])].filter(s=>s.source?.startsWith('請購表')).map(s=>s.effective_date||'').sort().at(-1)||'';}
export function baselineHasPurchase(row:PriceIngredient){return [row,...(row.sources||[])].some(s=>s.source?.startsWith('請購表'));}
function referencePriceLabel(row?:Pick<IngredientMaster,'source'|'source_kind'>){
 if(row?.source?.startsWith('請購表'))return '請購參考價';
 if(row?.source_kind==='history'||row?.source?.startsWith('歷史食譜'))return '食譜參考價';
 return '';
}
export function ingredientReferencePrice(row:PriceIngredient,supplier=''){
 const selected:PriceSource={...row,id:row.selected_reference||row.id,price:row.cost_price,
  source:row.source||'',effective_date:baselinePriceDate(row),supplier_name:row.supplier_name||'',supplier_key:row.supplier_key||''};
 const sources=baselineSources({...row,sources:[selected,...(row.sources||[])]}).filter(source=>source.review_status==='confirmed'
  &&source.price!==null&&Number.isFinite(source.price)&&source.price>=0
  &&referencePriceLabel(source)&&(!supplier||source.supplier_name===supplier));
 for(const source of sources){
  const purchase=originalIngredientPurchase(source.purchase)
   ||originalIngredientPurchase({amount:source.price!,quantity:1,unit:source.unit});
  if(purchase)return {purchase,supplier:source.supplier_name||'',date:source.effective_date,
   source:referencePriceLabel(source),reason:undefined};
 }
 return null;
}
export type BaselineGroup={key:string;name:string;rows:PriceIngredient[];purchase:boolean;history:boolean;purchaseDate:string};
export function baselineGroups(rows:PriceIngredient[]):BaselineGroup[]{
 const groups=new Map<string,PriceIngredient[]>();
 const roots=new Set(rows.map(r=>r.canonical_ingredient_id).filter(Boolean));
 for(const row of rows){
  // Real brand/package specifications and corrected aliases must not be guessed away.
  const specs=[...new Set(row.aliases.map(a=>(a.specification||'').normalize('NFKC').trim()).filter(s=>s&&!s.startsWith('原表計價基準:')))].sort();
  const purchase=ingredientPurchase(row);
  const packageKey=purchase?[purchase.unit,purchase.content_quantity||'',purchase.content_unit||'']:[];
  const uncertainPackage=usesPackageSpecification(purchase?.unit||row.unit)&&!purchase?.content_quantity;
  const key=row.canonical_ingredient_id|| (roots.has(row.id)?row.id:JSON.stringify([normalizedName(row.name),row.unit,specs,packageKey,baselineCategory(row),uncertainPackage||row.aliases.some(a=>a.corrected)?row.id:'']));
  groups.set(key,[...(groups.get(key)||[]),row]);
 }
 return [...groups].map(([key,members])=>{
  const sorted=[...members].sort((a,b)=>Number(a.id!==key)-Number(b.id!==key)||Number(!!b.manual)-Number(!!a.manual)||Number(baselineHasPurchase(b))-Number(baselineHasPurchase(a))||baselinePurchaseDate(b).localeCompare(baselinePurchaseDate(a))||Number(b.cost_price!==null)-Number(a.cost_price!==null)||a.id.localeCompare(b.id));
  return {key,name:baselineName(sorted[0].name),rows:sorted,purchase:members.some(baselineHasPurchase),history:false,purchaseDate:members.map(baselinePurchaseDate).sort().at(-1)||''};
 }).sort((a,b)=>Number(b.purchase)-Number(a.purchase)||Number(a.history)-Number(b.history)||b.purchaseDate.localeCompare(a.purchaseDate)||a.name.localeCompare(b.name,'zh-Hant')||a.key.localeCompare(b.key));
}

export type PriceSupplierProfile={id:string;name:string;aliases?:string[];supplier_category?:string;is_active?:boolean;is_removed?:boolean};
type PriceSupplier={active?:boolean;key:string;name:string;category:ReturnType<typeof supplierCategory>;aliases:string[]};
export type SupplierPriceRow={supplier:PriceSupplier;receipt?:IngredientReceiptPrice;unitReceipts?:IngredientReceiptPrice[];receiptQuotes?:CostQuote[];requestPrice?:IngredientReceiptPrice;reference?:PriceIngredient;editReference?:PriceIngredient};

export function backofficeReceiptName(row:PriceIngredient,offer?:SupplierPriceRow,latestReceipt?:IngredientReceiptPrice){
 const label=row.sheet_receipt_label;
 if(label&&(!offer||!label.supplier_key||label.supplier_key===offer.supplier.key))return label.name;
 return offer?.receipt?.name||(!offer?latestReceipt?.name:undefined)||offer?.requestPrice?.name||baselineName(offer?.reference?.name||row.name);
}

export function priceSheetSupplierIndex(groups:BaselineGroup[],suppliers:PriceSheetData['suppliers'],profiles:PriceSupplierProfile[],states:SupplyState[],assignments:Record<string,string>={}){
 const profilesById=new Map(profiles.map(profile=>[profile.id,profile]));
 const supplierIds=new Set(suppliers.map(supplier=>supplier.id));
 const directory=[
  ...suppliers.map(supplier=>({...profilesById.get(supplier.id),...supplier})),
  ...profiles.filter(profile=>!supplierIds.has(profile.id)&&(profile.is_active===false||profile.is_removed))
   .map(profile=>({...profile,active:false})),
 ];
 const byId=new Map(directory.map(supplier=>[`id:${supplier.id}`,supplier]));
 const byName=supplierNameIndex(directory);
 function resolve(key:string|undefined,value:string|undefined|null):PriceSupplier|null{
  const name=value?.trim()||'';
  const matches=byName.get(supplierNameKey(name));
  const supplier=(key&&byId.get(key))||(matches?.size===1?matches.values().next().value:undefined);
  if(supplier)return {active:supplier.active!==false&&supplier.is_active!==false&&!supplier.is_removed,key:`id:${supplier.id}`,name:supplier.name,category:supplierCategory(supplier.supplier_category),aliases:supplier.aliases||[]};
  return null;
 }
 const stopsByIngredient=new Map<string,SupplyState[]>();
 for(const state of states){
  if(!state.stopped||state.supplier_key==='*')continue;
  const stops=stopsByIngredient.get(state.ingredient_id);
  if(stops)stops.push(state);else stopsByIngredient.set(state.ingredient_id,[state]);
 }
 const pending:PendingSupplierSource[]=[];
 const index=new Map(groups.map(group=>{
  const stops=group.rows.flatMap(row=>[...(stopsByIngredient.get(row.id)||[]),...(stopsByIngredient.get(row.canonical_ingredient_id||'')||[])]);
  const stopped=new Set(stops.map(stop=>resolve(stop.supplier_key,stop.supplier_name)?.key||stop.supplier_key));
  const offers=new Map<string,SupplierPriceRow>();
  function add(key:string|undefined,name:string|undefined|null,entry:Omit<SupplierPriceRow,'supplier'>={}){
   const supplier=resolve(key,name);
   if(!supplier||stopped.has(supplier.key))return;
   const existing=offers.get(supplier.key);
   if(!existing||entry.editReference&&!existing.editReference)offers.set(supplier.key,{supplier,...existing,...entry});
   else if(entry.requestPrice&&(!existing.requestPrice||compareReceiptPrices(entry.requestPrice,existing.requestPrice)<0)){
    offers.set(supplier.key,{...existing,requestPrice:entry.requestPrice});
   }
  }
  for(const receipt of ingredientReceiptPrices(group.rows,'',stops)){
   const supplier=resolve(receipt.supplierKey,receipt.supplier);
   if(!supplier||stopped.has(supplier.key))continue;
   const existing=offers.get(supplier.key);
   if(!existing)offers.set(supplier.key,{supplier,receipt,unitReceipts:[receipt]});
   else if(!existing.unitReceipts?.some(item=>item.purchase.unit===receipt.purchase.unit))existing.unitReceipts?.push(receipt);
  }
  const receiptSuppliers=new Set(offers.keys());
  const lockedSuppliers=new Set<string>();
  for(const row of group.rows){
   const quote=row.current_quote;
   if((quote?.basis==='receipt'||quote?.basis==='locked')&&originalIngredientPurchase(quote.purchase)){
    const supplier=resolve(undefined,quote.supplier_name);
    if(supplier&&!stopped.has(supplier.key)){
     if(quote.basis==='receipt')receiptSuppliers.add(supplier.key);
     else lockedSuppliers.add(supplier.key);
    }
   }
   add(row.supplier_key||(row.supplier_id?`id:${row.supplier_id}`:undefined),row.supplier_name,{reference:row,editReference:row});
  }
  for(const row of group.rows){
   const quote=row.current_quote;
   add(undefined,quote?.supplier_name,{reference:row});
   if(quote?.basis!=='receipt'||!originalIngredientPurchase(quote.purchase))continue;
   const supplier=resolve(undefined,quote.supplier_name);
   const offer=supplier&&offers.get(supplier.key);
   if(offer)(offer.receiptQuotes??=[]).push(quote);
  }
  const unresolved=new Map<string,PendingSupplierSource>();
  const resolved=new Set<string>();
  for(const row of group.rows){
   for(const source of row.sources||[]){
    const name=source.receipt_supplier||source.supplier_name||source.source_ref?.supplier_name;
    const assigned=assignments[`${row.id}:${source.id}`];
    const supplier=resolve(source.supplier_key,name)||(assigned?resolve(`id:${assigned}`,undefined):null);
    if(supplier){
     const purchase=source.source_kind==='purchase'&&source.source?.startsWith('請購表')
      &&source.review_status==='confirmed'&&source.price!=null?originalIngredientPurchase(source.purchase):null;
     add(supplier.key,supplier.name,purchase?{requestPrice:{
      id:source.id,name:source.name,date:source.effective_date||'',createdAt:source.created_at||'',
      supplier:supplier.name,supplierKey:supplier.key,specification:source.source_ref?.specification,purchase,
     }}:{});
     resolved.add(source.id);
    }else if((name?.trim()||source.source_kind==='purchase')&&!unresolved.has(source.id)){
     unresolved.set(source.id,{group,row,source,original:name?.trim()||''});
    }
   }
  }
  pending.push(...[...unresolved.values()].filter(item=>!resolved.has(item.source.id)));
  // Imported references can fill a gap, but cannot add a supplier to a
  // receipt-backed item. Keep each actual supplier and any explicitly locked quote.
  const listed=[...offers.values()].filter(({supplier})=>
   !receiptSuppliers.size||receiptSuppliers.has(supplier.key)||lockedSuppliers.has(supplier.key));
  return [group.key,listed] as const;
 }));
 return {index,pending,isKnown:(key?:string,name?:string|null)=>!!resolve(key,name)};
}

export function supplierSheetPurchase(entry:SupplierPriceRow):ReturnType<typeof currentIngredientPurchase>&{receiptDate?:string|null}{
 const {receipt,reference,requestPrice,supplier}=entry;
 const quote=reference?.current_quote;
 const isSupplier=(name?:string|null)=>!!name&&[supplier.name,...supplier.aliases].some(alias=>supplierNameKey(alias)===supplierNameKey(name));
 const confirmed=entry.receiptQuotes??(quote?.basis==='receipt'&&isSupplier(quote.supplier_name)?[quote]:[]);
 const newest=confirmed.reduce<CostQuote|undefined>((best,item)=>
  !best||(item.date||'')>(best.date||'')?item:best,undefined);
 const quotePurchase=originalIngredientPurchase(newest?.purchase);
 if(quotePurchase&&(!receipt||(newest?.date||'')>receipt.date)){
  return {purchase:quotePurchase,supplier:supplier.name,date:newest?.date,receiptDate:newest?.date,source:'已確認建檔進貨',reason:undefined};
 }
 if(receipt)return {purchase:receipt.purchase,supplier:supplier.name,date:receipt.date,source:'已確認建檔進貨',reason:undefined,receiptDate:receipt.date};
 const matchingQuote=quote?.basis==='locked'&&isSupplier(quote.supplier_name||reference?.supplier_name);
 if(requestPrice&&!matchingQuote&&!reference?.manual){
  return {purchase:requestPrice.purchase,supplier:supplier.name,date:requestPrice.date,source:'請購參考價',reason:undefined,receiptDate:null};
 }
 const purchase=matchingQuote?originalIngredientPurchase(quote.purchase)
  :reference?.review_status==='confirmed'&&(entry.editReference===reference||isSupplier(reference.supplier_name))
   ?ingredientPurchase(reference)||ingredientReferencePrice(reference,supplier.name)?.purchase||(reference.current_quote===undefined&&reference.cost_price!=null
    ?originalIngredientPurchase({amount:reference.cost_price,quantity:1,unit:reference.unit}):null):null;
 const requestBasis=reference?.source?.startsWith('請購表');
 return {purchase,supplier:supplier.name,date:purchase&&requestBasis?baselinePriceDate(reference!):null,
  source:purchase?(matchingQuote?'鎖定進價':referencePriceLabel(reference)||'參考價'):'',reason:undefined,receiptDate:null};
}

// Each supplier/unit keeps its most recent invoice. A later import date on
// a requisition cannot displace an invoice, even when the price is zero.
export function sheetUnitPurchases(offers:SupplierPriceRow[]){
 type Price=ReturnType<typeof supplierSheetPurchase>;
 const candidates:{price:Price;receipt:boolean;createdAt:string;id:string}[]=[];
 for(const offer of offers){
  const price=supplierSheetPurchase(offer);
  candidates.push({price,receipt:!!price.receiptDate||price.source==='已確認建檔進貨',createdAt:'',id:''});
  for(const item of offer.unitReceipts||[]){
   candidates.push({price:{purchase:item.purchase,supplier:offer.supplier.name,date:item.date,receiptDate:item.date,source:'已確認建檔進貨',reason:undefined},
    receipt:true,createdAt:item.createdAt,id:item.id});
  }
  for(const quote of offer.receiptQuotes||[]){
   candidates.push({price:{purchase:originalIngredientPurchase(quote.purchase),supplier:offer.supplier.name,date:quote.date,receiptDate:quote.date,source:'已確認建檔進貨',reason:undefined},
    receipt:true,createdAt:'',id:quote.reference_id||''});
  }
 }
 candidates.sort((a,b)=>Number(b.receipt)-Number(a.receipt)||(b.price.date||'').localeCompare(a.price.date||'')
  ||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const prices=new Map<string,Price & {purchase:NonNullable<Price['purchase']>}>();
 for(const {price} of candidates){
  if(price.purchase&&!prices.has(price.purchase.unit))prices.set(price.purchase.unit,{...price,purchase:price.purchase});
 }
 return prices;
}

export function supplierSheetHistory(entry:SupplierPriceRow){
 const price=supplierSheetPurchase(entry);
 if(entry.receipt||price.receiptDate||price.source==='鎖定進價'||(entry.editReference?.manual&&price.purchase))return false;
 if(price.source==='請購參考價'||price.source==='食譜參考價')return false;
 return undefined;
}

export function priceChange(h:StandardHistory){
 const old=h.previous_snapshot,p=ingredientPurchase(h.snapshot),prev=old?ingredientPurchase(old):null;
 const before=old?(prev?.amount??old.cost_price):null,after=p?.amount??h.snapshot.cost_price;
 const shape=(r:IngredientMaster)=>{const v=ingredientPurchase(r);return JSON.stringify([r.unit,v?.unit||r.unit,v?.content_quantity||null,v?.content_unit||null]);};
 const note=!old||before===null?'原價未留存':after===null?'新價待補':shape(old)!==shape(h.snapshot)?'規格變更':!h.supplier_key||!h.previous_supplier_key?'供應商待核對':h.supplier_key!==h.previous_supplier_key?'供應商變更':before===0?'原價為零':'';
 return {before,after,note,percent:note||before===null||after===null?null:(after-before)/before*100};
}

export type IngredientReceiptPrice = {
 id:string; name:string; date:string; createdAt:string; supplier:string; supplierKey:string; batchId?:string; specification?:string; purchase:NonNullable<ReturnType<typeof ingredientPurchase>>;
};
const compareReceiptPrices=(a:IngredientReceiptPrice,b:IngredientReceiptPrice)=>b.date.localeCompare(a.date)
 ||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id);
function originalIngredientPurchase(p:RecipePurchase|null|undefined){
 if(!p||!Number.isFinite(p.amount)||p.amount<0||!Number.isFinite(p.quantity)||p.quantity<=0||!p.unit?.trim())return null;
 return {...p,amount:p.amount/p.quantity,quantity:1};
}
export function ingredientReceiptPrices(members:PriceIngredient[], supplier='',states:SupplyState[]=[]):IngredientReceiptPrice[]{
 const stops=states.filter(state=>state.stopped&&state.supplier_key!=='*'&&members.some(member=>
  member.id===state.ingredient_id||member.canonical_ingredient_id===state.ingredient_id));
 const sources=new Map(members.flatMap(m=>(m.sources||[]).map(s=>[s.id,s] as const)));
 const rows:IngredientReceiptPrice[]=[];
 for(const s of sources.values()){
  if(s.receipt_price==null||s.receipt_price<0||!s.receipt_unit||!s.effective_date)continue;
  const purchase=originalIngredientPurchase(s.receipt_purchase)||originalIngredientPurchase({amount:s.receipt_price,quantity:1,unit:s.receipt_unit});
  const name=s.receipt_supplier||s.supplier_name;
  if(purchase&&(!supplier||name===supplier)&&!stops.some(state=>state.supplier_key===s.supplier_key
   ||!!name&&state.supplier_name.normalize('NFKC').trim().toLowerCase()===name.normalize('NFKC').trim().toLowerCase())){
   rows.push({id:s.id,name:s.name?.trim()||'',date:s.effective_date,createdAt:s.created_at||'',supplier:name,supplierKey:s.supplier_key,batchId:s.source_ref?.batch_id,...(s.source_ref?.specification?{specification:s.source_ref.specification}:{}),purchase});
  }
 }
 return rows.sort(compareReceiptPrices);
}
export function ingredientPurchaseChanges(data:PriceSheetData){
 const suppliers=data.suppliers.filter(supplier=>supplier.active!==false);
 const byName=supplierNameIndex(suppliers);
 const byKey=new Map(suppliers.map(supplier=>[`id:${supplier.id}`,supplier]));
 const ingredients=new Map<string,PriceIngredient[]>();
 for(const row of data.ingredients){
  const id=row.canonical_ingredient_id||row.id;
  const members=ingredients.get(id);
  if(members)members.push(row);
  else ingredients.set(id,[row]);
 }
 return [...ingredients].flatMap(([id,members])=>{
  const row=members.find(member=>member.id===id)||members[0];
  if(isIngredientStopped(row,data.supply_states))return [];
  const series=new Map<string,IngredientReceiptPrice[]>();
  for(const receipt of ingredientReceiptPrices(members,'',data.supply_states)){
   const names=byName.get(supplierNameKey(receipt.supplier));
   const supplier=byKey.get(receipt.supplierKey)||(names?.size===1?names.values().next().value:undefined);
   if(!supplier)continue;
   const {unit,content_quantity}=receipt.purchase;
   const spec=supplierNameKey(receipt.specification||'');
   if(usesPackageSpecification(unit)&&!content_quantity&&!spec)continue;
   const key=JSON.stringify([supplier.id,recipeFactor(unit),ingredientPackageKey(receipt.purchase),content_quantity?'':spec]);
   const formatted={...receipt,supplier:supplier.name};
   const history=series.get(key);
   if(history)history.push(formatted);
   else series.set(key,[formatted]);
  }
  return [...series].flatMap(([key,history])=>{
   const latest=history[0];
   const differentReceipt=(r:IngredientReceiptPrice)=>(r.batchId||r.id)!==(latest.batchId||latest.id);
   const previous=history.find(differentReceipt);
   const latestAmount=Math.round(latest.purchase.amount*10000);
   if(!previous||latestAmount===Math.round(previous.purchase.amount*10000))return [];
   if(history.some(receipt=>{
    const batch=receipt.batchId||receipt.id;
    const base=batch===(latest.batchId||latest.id)?latest:batch===(previous.batchId||previous.id)?previous:null;
    return base&&Math.round(receipt.purchase.amount*10000)!==Math.round(base.purchase.amount*10000);
   }))return [];
   const percent=previous.purchase.amount===0?null:(latest.purchase.amount-previous.purchase.amount)/previous.purchase.amount*100;
   return [{key:`${id}:${key}`,row,latest,previous,percent}];
  });
 }).sort((a,b)=>compareReceiptPrices(a.latest,b.latest));
}
export function latestSupplierPurchases(receipts:IngredientReceiptPrice[], suppliers:PriceSheetData['suppliers']){
 const latest=new Map<string,IngredientReceiptPrice&{supplierId:string}>();
 for(const receipt of receipts){
  const matches=suppliers.filter(s=>s.active!==false&&(receipt.supplierKey?.startsWith('id:')
   ?receipt.supplierKey==='id:'+s.id:!!receipt.supplier&&normalizedName(s.name)===normalizedName(receipt.supplier)));
  if(matches.length!==1||latest.has(matches[0].id))continue;
  latest.set(matches[0].id,{...receipt,supplier:matches[0].name,supplierId:matches[0].id});
 }
 return [...latest.values()];
}
export function ingredientPackageLabel(p:{unit:string;content_quantity?:number;content_unit?:string}){
 const content=formatPurchaseSpecification(p.content_quantity,p.content_unit);
 return content?`${content}／${p.unit}`:usesPackageSpecification(p.unit)?`${p.unit} · 內容量待補`:p.unit;
}
export function ingredientPackageKey(p:{unit:string;content_quantity?:number;content_unit?:string}){
 const contentUnit=recipeUnit(p.content_unit||'');
 return JSON.stringify([recipeUnit(p.unit),contentUnit,(p.content_quantity||0)*recipeFactor(p.content_unit||'')]);
}
export function ingredientPerBaseUnit(p:IngredientReceiptPrice['purchase']){
 for(const [unit,label] of [['公斤','公斤'],['L','公升']] as const){
  const price=purchaseUnitPrice(p,unit);
  if(price!==null)return {price,label};
 }
 return null;
}
export function ingredientReviewGroups(groups:BaselineGroup[]){
 const byName=new Map<string,BaselineGroup[]>();
 for(const g of groups){
  const name=normalizedName(g.name);
  // Imported names can repeat the package already present in the item name.
  const repeatedPackage=name.replace(/\s+/gu,'').match(/^(.*)·(\d+(?:\.\d+)?(?:kg|g|ml|l|公斤|公克|克|毫升|公升)\/(?:包|袋|盒|瓶|罐|箱))$/u);
  const reviewName=repeatedPackage&&repeatedPackage[1].split(/[,、;()·]/u).includes(repeatedPackage[2])?repeatedPackage[1]:name;
  const key=reviewName.replace(/\s*·\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|公斤|公克|克|毫升|公升)\s*$/iu,'').replace(/\s+/gu,'');
  const list=byName.get(key);
  if(list)list.push(g);else byName.set(key,[g]);
 }
 return [...byName].flatMap(([key,matching])=>{
  const members=matching.map(g=>g.rows[0]);
  const missing=members.filter(r=>{
   const p=ingredientPurchase(r);
   return usesPackageSpecification(p?.unit||r.unit)&&!p?.content_quantity;
  });
  if(members.length<2&&!missing.length)return [];
  const rows=[...members].sort((a,b)=>Number(missing.includes(a))-Number(missing.includes(b))||Number(!!b.manual)-Number(!!a.manual)||baselinePriceDate(b).localeCompare(baselinePriceDate(a))||a.id.localeCompare(b.id));
  return [{key,name:baselineName(rows[0].name),rows,missing:missing.length}];
 });
}

export type SheetOfferEntry={group:BaselineGroup;row:PriceIngredient;offer:SupplierPriceRow|undefined};

export function sheetServiceFee(name:string){
 return isFreightName(name)||/(?:分切費|分切工資)$/u.test(name.trim());
}

const reviewText=(name:string)=>baselineName(name).toLowerCase().replace(/\s+/gu,'').replace(/冷凍酥片/gu,'冷凍起酥片');
function packageDescription(name:string){
 const label=reviewText(name);
 const parts=label.split('·');
 const text=parts.length===2&&parts[0].includes(parts[1])?parts[0]:label;
 const match=text.match(/^(.*?)[·-]?(\d+(?:\.\d+)?)(kg|g|公斤|公克|克)(?:[×x/](\d+)(?:pcs?|p|片|入))?$/u);
 if(!match)return null;
 const grams=Number(match[2])*(match[3]==='kg'||match[3]==='公斤'?1000:1);
 return {stem:match[1],grams,count:Number(match[4]||1)};
}

// Only an explicit pack count can connect a per-piece weight to a carton weight.
// Size-specific or ambiguous packs keep separate rows. Review never changes the IDs.
export function priceReviewBundles(entries:SheetOfferEntry[]){
 const packKeys=new Map<string,Set<string>>();
 const records=entries.map(entry=>{
  const {row,offer}=entry;
  const name=reviewText(backofficeReceiptName(row,offer));
  const scope=[offer?.supplier.key||row.id,baselineCategory(offer?.reference||row)];
  const pack=packageDescription(name);
  if(pack&&pack.count>1){
   const carton=JSON.stringify([pack.grams,pack.count]);
   for(const weight of [pack.grams,pack.grams*pack.count]){
    const key=JSON.stringify([...scope,pack.stem,weight]);
    const options=packKeys.get(key)||new Set<string>();
    options.add(carton);packKeys.set(key,options);
   }
  }
  return {entry,name,scope,pack};
 });
 const bundles=new Map<string,SheetOfferEntry[]>();
 for(const {entry,name,scope,pack} of records){
  const {row,offer}=entry;
  let family=name.replace(/^(?:安格斯黑)(牛肝)$/u,'$1');
  const spec=offer?.receipt?.specification||offer?.requestPrice?.specification||
   row.aliases.map(alias=>alias.specification).filter(value=>value&&!value.startsWith('原表計價基準')).sort().join(' ');
  let specification=reviewText(spec);
  const purchase=offer&&supplierSheetPurchase(offer).purchase;
  let content=purchase?.content_quantity?formatPurchaseSpecification(purchase.content_quantity,purchase.content_unit):'';
  if(pack){
   const options=packKeys.get(JSON.stringify([...scope,pack.stem,pack.grams]));
   const carton=pack.count>1?JSON.stringify([pack.grams,pack.count]):options?.size===1?[...options][0]:'';
   if(carton){
    family=pack.stem+carton;
    const [grams,count]=JSON.parse(carton) as [number,number];
    const repeatsWeight=(value:string)=>{
     const stated=packageDescription(value);
     return stated&&stated.stem===''&&[grams,grams*count].includes(stated.grams);
    };
    if(repeatsWeight(specification))specification='';
    if(repeatsWeight(content))content='';
   }
  }
  const key=JSON.stringify([...scope,family,specification,content]);
  const members=bundles.get(key);
  if(members)members.push(entry);
  else bundles.set(key,[entry]);
 }
 return [...bundles.values()].map(members=>members.sort((a,b)=>{
  const ap=a.offer&&supplierSheetPurchase(a.offer),bp=b.offer&&supplierSheetPurchase(b.offer);
  return Number(!!bp?.receiptDate)-Number(!!ap?.receiptDate)
   ||(bp?.date||b.group.purchaseDate).localeCompare(ap?.date||a.group.purchaseDate)
   ||(a.offer?.receipt&&b.offer?.receipt?compareReceiptPrices(a.offer.receipt,b.offer.receipt):0)
   ||backofficeReceiptName(b.row,b.offer).length-backofficeReceiptName(a.row,a.offer).length||(a.row.ingredient_code||a.row.id).localeCompare(b.row.ingredient_code||b.row.id);
 }));
}
