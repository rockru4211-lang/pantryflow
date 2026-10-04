import {normalizeRecipePurchase,recipeFactor,recipeUnit,type RecipePrice,type RecipePriceReference,type RecipePurchase,type RecipeWorkspace} from './recipe-cost';

export const priceSupplier=(p?:RecipePrice)=>p?.supplier_name||p?.source_ref?.supplier_name||'';
export const priceNumber=(n:number)=>n.toLocaleString('zh-TW',{maximumFractionDigits:6});
export const priceSource=(p?:RecipePrice)=>p?.source_kind==='history'?'歷史食譜':p?.source_kind==='purchase'||p?.source==='已核對進貨'?'進貨／請購':'手動補價';
export const priceIdentity=(p:RecipePrice)=>`${p.key}\u0000${recipeUnit(p.unit)}`;
export function pricePackage(p:RecipePrice){
 const q=p.purchase;if(!q)return '原表單位價';
 if(q.quantity!==1)return `${priceNumber(q.amount)} 元／${priceNumber(q.quantity)} ${q.unit}`;
 if(q.content_quantity&&q.content_unit)return `1 ${q.unit}＝${priceNumber(q.content_quantity)} ${q.content_unit}`;
 const factor=recipeFactor(q.unit);return factor!==1?`1 ${q.unit}＝${factor} ${recipeUnit(q.unit)}`:`按${q.unit}計價`;
}
export type PriceRegisterRow={id:string;key:string;name:string;unit:string;product_id:string|null;price?:RecipePrice;status:'current'|'reference'|'pending'|'missing';uses:string[]};
const quoteGroup=(p:RecipePrice)=>JSON.stringify([priceIdentity(p),priceSupplier(p),p.purchase?.unit,p.purchase?.content_quantity,p.purchase?.content_unit,p.source_ref?.specification]);
const quoteSignature=(p:RecipePrice)=>JSON.stringify([p.reference_id,p.price,p.source,p.effective_date]);
export function priceRegisterRows(ws:RecipeWorkspace):PriceRegisterRow[]{
 const uses=new Map<string,Set<string>>(),ingredients=new Map<string,{key:string;name:string;unit:string;product_id:string|null}>();
 for(const r of ws.recipes)for(const l of r.document.lines){
  if(l.recipe_id||!l.name.trim())continue;
  const item={key:l.product_id?`p:${l.product_id}`:`n:${l.name.trim().toLowerCase()}`,name:l.name,unit:recipeUnit(l.unit),product_id:l.product_id||null};
  const k=priceIdentity(item as RecipePrice);ingredients.set(k,item);const names=uses.get(k)||new Set<string>();names.add(r.document.name.trim());uses.set(k,names);
 }
 const rows:PriceRegisterRow[]=[],groups=new Set<string>(),present=new Set<string>();
 const currentQuotes=new Set(ws.prices.filter(p=>p.reference_id).map(quoteSignature));
 const add=(p:RecipePrice,status:PriceRegisterRow['status'])=>{const key=priceIdentity(p);rows.push({id:`${status}:${p.reference_id||p.source_id||rows.length}:${key}`,key:p.key,name:p.name,unit:p.unit,product_id:p.product_id,price:p,status,uses:[...(uses.get(key)||[])]});present.add(key);};
 for(const p of ws.prices){add(p,'current');groups.add(quoteGroup(p));}
 const references=ws.price_references||ws.price_candidates?.map(p=>({...p,review_status:'pending' as const,created_at:''}))||[];
 for(const p of [...references].sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')||b.created_at.localeCompare(a.created_at))){
  if(p.reference_id&&currentQuotes.has(quoteSignature(p)))continue;
  const group=quoteGroup(p)+':'+p.review_status;
  if(groups.has(group)||p.review_status==='confirmed'&&groups.has(quoteGroup(p)))continue;
  groups.add(group);add(p,p.review_status==='pending'?'pending':'reference');
 }
 for(const [key,item]of ingredients)if(!present.has(key))rows.push({...item,id:`missing:${key}`,status:'missing',uses:[...(uses.get(key)||[])]});
 return rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-TW')||Number(b.status==='current')-Number(a.status==='current')||priceSupplier(a.price).localeCompare(priceSupplier(b.price),'zh-TW'));
}
export const priceNeedsAttention=(r:PriceRegisterRow)=>r.status==='missing'||r.status==='pending'||!!r.price?.conversion_pending||!priceSupplier(r.price);
export function priceHistory(row:PriceRegisterRow,ws:RecipeWorkspace):RecipePriceReference[]{return (ws.price_references||[]).filter(p=>p.key===row.key).sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')||b.created_at.localeCompare(a.created_at));}
export type RegisterDraft={name:string;productId:string;unit:string;supplier:string;supplierId:string;specification:string;amount:string;purchaseUnit:string;content:string;contentUnit:string;estimate:string;source:string;date:string;referenceId?:string;matchedProductId:string};
export function registerDraft(row?:PriceRegisterRow):RegisterDraft{
 const p=row?.price,q=p?.purchase;const raw=q?q.amount/q.quantity:p?.price;
 const estimate=q?.cost_unit_price??(p?.cost_price!=null&&p.price>0&&raw!==undefined?raw*p.cost_price/p.price:p?.cost_price);
 return {name:row?.name||'',productId:row?.product_id||'',unit:row?.unit||'g',supplier:priceSupplier(p),supplierId:p?.source_ref?.supplier_id||'',specification:p?.source_ref?.specification||'',amount:raw===undefined||row?.status==='pending'&&p?.source_ref?.missing_price?'':String(raw),purchaseUnit:q?.unit||p?.unit||'公斤',content:q?.content_quantity?String(q.content_quantity):'',contentUnit:q?.content_unit||row?.unit||'g',estimate:estimate!=null&&estimate!==raw?String(estimate):'',source:p?.source||'手動補價',date:p?.reference_id?p.effective_date||'':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),referenceId:p?.reference_id,matchedProductId:p?.source_ref?.product_id||row?.product_id||''};
}
export function registerPriceInput(d:RegisterDraft){
 if(!d.name.trim())throw Error('請填食材名稱。');
 if(!d.amount.trim()||!d.purchaseUnit.trim()||!d.unit.trim())throw Error('請填採購單價與單位。');
 if(!d.source.trim()||(!d.date&&!d.referenceId))throw Error('請填價格來源與日期。');
 const conversion=recipeUnit(d.purchaseUnit)!==recipeUnit(d.unit);
 if(conversion&&!d.content.trim())throw Error(`請填每 1 ${d.purchaseUnit} 的內容量。`);
 const purchase:RecipePurchase={amount:Number(d.amount),quantity:1,unit:d.purchaseUnit,...(conversion?{content_quantity:Number(d.content),content_unit:d.contentUnit}:{}),...(d.estimate.trim()?{cost_unit_price:Number(d.estimate)}:{})};
 const normalized=normalizeRecipePurchase(purchase,d.unit);
 return {name:d.name.trim(),product_id:d.productId||null,unit:normalized.unit,price:normalized.price,purchase,source:d.source.trim(),effective_date:d.date||null,reference_id:d.referenceId,supplier_name:d.supplier.trim(),supplier_id:d.supplierId||null,specification:d.specification.trim(),matched_product_id:d.matchedProductId||null};
}

// Price movement compares raw normalized prices; a costing estimate never becomes a purchase price.
export function priceMovement(p?:RecipePrice){
 if(!p||p.source_kind!=='purchase'||p.previous_price==null||!Number.isFinite(p.previous_price)||p.previous_price<0)return null;
 const difference=p.price-p.previous_price;
 const pack=p.purchase,prior=p.previous_purchase,samePack=pack&&prior&&pack.unit===prior.unit&&pack.quantity>0&&prior.quantity>0;
 return {difference,percent:p.previous_price>0?difference/p.previous_price*100:null,previous:p.previous_price,previousAmount:samePack?prior.amount/prior.quantity:p.previous_price,currentAmount:samePack?pack.amount/pack.quantity:p.price,unit:samePack?pack.unit:p.unit};
}
export function priceMode(p?:RecipePrice){
 if(!p)return '待補價格';
 if(p.conversion_pending)return '待確認換算';
 if(p.cost_price!=null&&p.cost_price>p.price)return '高估價';
 if(p.source_kind==='history')return '歷史價格';
 if(p.source_kind==='purchase')return '跟隨進價';
 return '手動補價';
}
