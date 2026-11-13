import {ingredientDraft,formatPurchaseSpecification,usesPackageSpecification,ingredientPurchase,type IngredientMaster,type IngredientSource,type IngredientDraft} from './ingredient-catalog.ts';
import {recipeFactor,recipeUnit,type RecipePurchase} from './recipe-model.ts';
import {purchaseUnitPrice,type CostQuote} from './cost-price.ts';
export type SupplyState={ingredient_id:string;supplier_key:string;supplier_name:string;replacement?:string;stopped:boolean;reason:string;disposition:string;note:string;revision:number;updated_at:string};
export type SupplyEvent={id:string;ingredient_id:string;supplier_key:string;supplier_name:string;action:'stop'|'restore'|'note';replacement?:string;reason:string;disposition:string;note:string;created_at:string;actor_id:string;actor_name?:string;snapshot:IngredientMaster};
export type PriceIngredient=IngredientMaster&{current_quote?:CostQuote|null;category?:string|null;price_date?:string|null;supplier_id?:string|null;supplier_name?:string;supplier_key?:string;sources?:PriceSource[];dismissed_reference?:string;dismissed_value?:number};
export type PriceSource=IngredientSource&{supplier_key:string;supplier_name:string;created_at?:string;can_apply?:boolean;receipt_price?:number|null;receipt_unit?:string|null;receipt_purchase?:RecipePurchase|null;receipt_supplier?:string|null};
export type StandardHistory={id:string;ingredient_id:string;effective_date:string;reason:string;actor_name:string;snapshot:IngredientMaster;previous_snapshot?:IngredientMaster|null;supplier_key?:string|null;previous_supplier_key?:string|null;supplier_name?:string|null;created_at:string};
export type PriceSheetData={price_history?:StandardHistory[];ingredients:PriceIngredient[];can_price:boolean;supply_states:SupplyState[];supply_events:SupplyEvent[];suppliers:{id:string;name:string;active:boolean}[]};
export const emptyPriceSheet:PriceSheetData={ingredients:[],can_price:false,supply_states:[],supply_events:[],suppliers:[]};
export function isIngredientStopped(row:IngredientMaster,states:SupplyState[]){return states.some(s=>(s.ingredient_id===row.id||s.ingredient_id===row.canonical_ingredient_id)&&s.supplier_key==='*'&&s.stopped);}
export function priceCandidate(row:PriceIngredient,states:SupplyState[]){
 if(isIngredientStopped(row,states))return null;
 const q=(row.sources||[]).filter(q=>q.can_apply!==false&&q.review_status==='confirmed'&&q.source_kind==='purchase'&&q.price!==null&&q.unit===row.unit&&(!row.effective_date||!!q.effective_date&&q.effective_date>=row.effective_date)&&!states.some(s=>s.ingredient_id===row.id&&s.supplier_key===q.supplier_key&&s.stopped)).sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')||(b.created_at||'').localeCompare(a.created_at||''))[0];
 return q&&q.id!==row.selected_reference&&q.price!==row.cost_price&&!(row.dismissed_reference===q.id&&row.dismissed_value===q.price)?q:null;
}
export function supplierOptions(row:PriceIngredient){const m=new Map<string,string>();if(row.supplier_key)m.set(row.supplier_key,row.supplier_name||'未命名供應商');for(const s of row.sources||[])if(s.supplier_key)m.set(s.supplier_key,s.supplier_name||'未命名供應商');return [...m].map(([key,name])=>({key,name}));}
export function priceSearch(row:PriceIngredient,term:string){return [row.canonical_code,row.ingredient_code,row.name,row.supplier_name,...(row.recipe_aliases||[]),...row.aliases.map(a=>a.name),...(row.sources||[]).map(s=>s.supplier_name)].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export function candidatePurchase(q:PriceSource){return ingredientPurchase({purchase:q.purchase})||{amount:q.price,unit:q.unit};}
export const priceCategories=['食材','耗材','調料','酒水','待分類'];
export const baselineCategory=(row?:PriceIngredient)=>priceCategories.includes(row?.category||'')?row!.category!:'待分類';
export const baselinePriceDate=(row:PriceIngredient)=>row.price_date!==undefined?row.price_date||'':row.manual?'':row.effective_date||'';
export const priceEdit=(row?:PriceIngredient)=>({...ingredientDraft(row),category:baselineCategory(row),effective_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:'供應商調價',supplier_id:row?.supplier_id||(row?.supplier_key?.startsWith('id:')?row.supplier_key.slice(3):'')||''});

export function currentIngredientPurchase(row:PriceIngredient,receipts:IngredientReceiptPrice[],supplier=''){
 const quote=row.current_quote;
 const receipt=receipts.find(r=>!supplier||r.supplier===supplier);
 if(quote?.basis==='locked')return {purchase:originalIngredientPurchase(quote.purchase),supplier:quote.supplier_name||row.supplier_name,date:quote.date,source:'鎖定進價',reason:quote.reason};
 const quotePurchase=quote&&(quote.price!=null||quote.basis==='receipt')?originalIngredientPurchase(quote.purchase):null;
 if(quotePurchase&&(!supplier||quote?.supplier_name===supplier)&&(!receipt
  ||quote?.basis==='receipt'&&(quote.date||'')>=receipt.date)){
  return {purchase:quotePurchase,supplier:quote?.supplier_name||receipt?.supplier||row.supplier_name,date:quote?.date,source:quote?.source,reason:quote?.reason};
 }
 if(receipt)return {purchase:receipt.purchase,supplier:receipt.supplier,date:receipt.date,source:'已確認建檔進貨'};
 const legacyPrice=supplier&&supplier!==(quote?.supplier_name||row.supplier_name)?null:quote?.price??(row.current_quote===undefined?row.cost_price:null);
 const fallback=(!supplier||supplier===row.supplier_name)&&row.review_status==='confirmed'
  &&!(quote?.basis==='receipt'&&quote.price===null)?originalIngredientPurchase(row.purchase):null;
 const purchase=fallback||(legacyPrice!=null?originalIngredientPurchase({amount:legacyPrice,quantity:1,unit:quote?.unit||row.unit}):null);
 return {purchase,supplier:quote?.supplier_name||row.supplier_name,date:quote?.date||(purchase?baselinePriceDate(row):null),source:quote?.source||(purchase?row.manual?'標準價':'已確認價格':''),reason:quote?.reason};
}

/** Metadata edits must not turn an imported price into a manual baseline. */
export function priceSavePreservesBaseline(edit:PriceSheetEdit){
 if(!edit.row)return false;
 const original=edit.initialDraft||priceEdit(edit.row);
 return (['price','unit','reference','specification','content','contentUnit','effective_date','change_reason'] as const).every(field=>edit.draft[field]===original[field]);
}

export type PriceSheetEdit={row?:PriceIngredient;draft:IngredientDraft&{supplier_id:string;category?:string};requestId:string;recipeAlias?:string;aliasRequestId?:string;metadataSaved?:boolean;single?:boolean;initialDraft?:IngredientDraft&{supplier_id:string;category?:string}};

// Prefer persisted canonical links; legacy display groups keep original IDs and prices intact.
export const baselineName=(name:string)=>name.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim().replace(/\s+/gu,' ');
const normalizedName=(name:string)=>baselineName(name).toLocaleLowerCase();
export function baselineSourceRank(source?:string,kind?:string){
 if(source?.startsWith('請購表'))return 0;
 if(kind==='history'||source?.startsWith('歷史食譜'))return 2;
 return 1;
}
export function baselineSources(row:PriceIngredient){return [...(row.sources||[])].sort((a,b)=>baselineSourceRank(a.source,a.source_kind)-baselineSourceRank(b.source,b.source_kind)||(b.effective_date||'').localeCompare(a.effective_date||'')||a.id.localeCompare(b.id));}
export function baselinePurchaseDate(row:PriceIngredient){return [row,...(row.sources||[])].filter(s=>s.source?.startsWith('請購表')).map(s=>s.effective_date||'').sort().at(-1)||'';}
export function baselineHasPurchase(row:PriceIngredient){return [row,...(row.sources||[])].some(s=>s.source?.startsWith('請購表'));}
export function baselineHistoryOnly(row:PriceIngredient){const refs=[row,...(row.sources||[])].filter(s=>s.source||s.source_kind);return !row.manual&&refs.length>0&&refs.every(s=>baselineSourceRank(s.source,s.source_kind)===2);}
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
  return {key,name:baselineName(sorted[0].name),rows:sorted,purchase:members.some(baselineHasPurchase),history:members.every(baselineHistoryOnly),purchaseDate:members.map(baselinePurchaseDate).sort().at(-1)||''};
 }).sort((a,b)=>Number(b.purchase)-Number(a.purchase)||Number(a.history)-Number(b.history)||b.purchaseDate.localeCompare(a.purchaseDate)||a.name.localeCompare(b.name,'zh-Hant')||a.key.localeCompare(b.key));
}

export function priceChange(h:StandardHistory){
 const old=h.previous_snapshot,p=ingredientPurchase(h.snapshot),prev=old?ingredientPurchase(old):null;
 const before=old?(prev?.amount??old.cost_price):null,after=p?.amount??h.snapshot.cost_price;
 const shape=(r:IngredientMaster)=>{const v=ingredientPurchase(r);return JSON.stringify([r.unit,v?.unit||r.unit,v?.content_quantity||null,v?.content_unit||null]);};
 const note=!old||before===null?'原價未留存':after===null?'新價待補':shape(old)!==shape(h.snapshot)?'規格變更':!h.supplier_key||!h.previous_supplier_key?'供應商待核對':h.supplier_key!==h.previous_supplier_key?'供應商變更':before===0?'原價為零':'';
 return {before,after,note,percent:note||before===null||after===null?null:(after-before)/before*100};
}

export type IngredientReceiptPrice = {
 id:string; name:string; date:string; createdAt:string; supplier:string; supplierKey:string; purchase:NonNullable<ReturnType<typeof ingredientPurchase>>;
};
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
   rows.push({id:s.id,name:baselineName(s.name||''),date:s.effective_date,createdAt:s.created_at||'',supplier:name,supplierKey:s.supplier_key,purchase});
  }
 }
 return rows.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
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
