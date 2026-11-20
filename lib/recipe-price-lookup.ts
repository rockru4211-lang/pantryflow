import {recipeCost,recipeFactor,recipeUnit,type RecipeLine,type RecipePrice,type RecipeWorkspace} from './recipe-cost.ts';
import {recipePriceDraft,recipePriceKey,draftRecipePrice,type RecipePriceDraft} from './recipe-price-draft.ts';
import type {InventoryPriceOffer} from './inventory-valuation.ts';
export type RecipeLookupSource='receipt'|'request'|'history'|'manual';
export const recipeLookupLabels:Record<RecipeLookupSource,string>={receipt:'進貨明細',request:'請購表',history:'原食譜',manual:'食材價格表'};
export type RecipeLookupOption={id:string;name:string;code?:string;supplier:string;specification:string;source:RecipeLookupSource;price:RecipePrice;stopped?:boolean;remote?:boolean;pending?:boolean};
export function recipeLookupSource(price:RecipePrice):RecipeLookupSource{
 if(price.source.includes('請購'))return 'request';
 if(price.source_kind==='history'||/^(原食譜|歷史食譜|食譜紀錄)/.test(price.source))return 'history';
 if(price.source_kind==='purchase'||/進貨/.test(price.source))return 'receipt';
 return 'manual';
}
export function recipeLookupOffers(offers:InventoryPriceOffer[]):RecipeLookupOption[]{
 return offers.flatMap(offer=>{
  const q=offer.quote,p=q.purchase;if(!p||!(p.quantity>0)||!Number.isFinite(p.amount)||p.amount<0)return [];
  const price:RecipePrice={key:`lookup:${q.reference_id}`,name:offer.name,product_id:null,unit:recipeUnit(p.unit),price:p.amount/p.quantity/recipeFactor(p.unit),purchase:p,source:q.source||'食材價格表',source_kind:q.basis==='receipt'||q.basis==='purchase'?'purchase':'manual',effective_date:q.date||null};
  return [{id:`lookup:${q.reference_id}`,name:offer.name,code:offer.code,supplier:q.supplier_name||'',specification:q.specification||'',source:recipeLookupSource(price),price,stopped:offer.stopped,remote:true}];
 });
}
export function recipeLookupOptions(workspace:RecipeWorkspace,query:string,remote:RecipeLookupOption[]=[]):RecipeLookupOption[]{
 const term=query.normalize('NFKC').trim().toLowerCase(),seen=new Set<string>();
 const locals=[...workspace.prices,...(workspace.price_references||[]),...(workspace.price_candidates||[])].map((price,index):RecipeLookupOption=>({id:`local:${price.reference_id||index}:${price.key}:${price.unit}`,name:price.name,price,supplier:price.supplier_name||price.source_ref?.supplier_name||price.source.match(/供應商：([^·\n]+)/)?.[1]?.trim()||'',specification:price.source_ref?.specification||'',source:recipeLookupSource(price),pending:'review_status' in price&&price.review_status==='pending'}));
 return [...remote,...locals].filter(option=>{
  const p=option.price,master=workspace.ingredients?.find(row=>p.key===`i:${row.id}`),names=[option.name,option.supplier,option.code,master?.ingredient_code,master?.canonical_code,...(master?.recipe_aliases||[]),...(master?.aliases.map(a=>a.name)||[])].join(' ').normalize('NFKC').toLowerCase();
  if(!term||!names.includes(term))return false;
  const signature=JSON.stringify([option.name,option.supplier,p.purchase,p.unit,p.price,p.effective_date,option.source]);
  if(seen.has(signature))return false;seen.add(signature);return true;
 }).sort((a,b)=>({receipt:0,request:1,manual:2,history:3}[a.source]-{receipt:0,request:1,manual:2,history:3}[b.source])||(b.price.effective_date||'').localeCompare(a.price.effective_date||''));
}
export function recipeLookupDraft(line:RecipeLine,option:RecipeLookupOption,workspace:RecipeWorkspace):RecipePriceDraft{
 const price={...option.price,key:recipePriceKey(line)};
 const draft=recipePriceDraft({...line,unit:price.unit},{...workspace,prices:[price]},'');
 // Remote receipt/standard IDs are not recipe_price_entries IDs. A consciously
 // selected different product is saved as a scoped recipe quote, never relabelled
 // as the old ingredient's validated reference.
 const same=!option.remote&&price.name===line.name&&price.product_id===(line.product_id||null);
 return {...draft,lookupSource:recipeLookupLabels[option.source],referenceId:same?price.reference_id:undefined,source:[price.source,option.supplier?`供應商：${option.supplier}`:'',!price.effective_date?'原價日期未記載':''].filter(Boolean).join(' · '),date:price.effective_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),supplierName:option.supplier,supplierId:price.source_ref?.supplier_id,amountEdited:false};
}
export function recipeLookupPreview(line:RecipeLine,draft:RecipePriceDraft,workspace:RecipeWorkspace,sourceText:string){
 try{
  const price=draftRecipePrice(line,draft,sourceText),doc={name:'',kind:'dish' as const,yield:'1',unit:'份',notes:sourceText,lines:[{...line,quantity:'1'}]};
  const unitCost=recipeCost(doc,{...workspace,cost_mode:'latest',prices:[price]}).total;
  const quantity=Number(line.quantity);
  return {unitCost,amount:unitCost!==null&&line.quantity.trim()&&quantity>0?unitCost*quantity:null};
 }catch{return {unitCost:null,amount:null};}
}
