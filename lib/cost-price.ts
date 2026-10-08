import {formatPurchaseSpecification} from './purchase-specification.ts';
import {recipeUnit,recipeFactor,type RecipePurchase} from './recipe-model.ts';
import type {SheetRow} from './operations-sheet.ts';
export type CostQuote={price:number|null;source?:string;date?:string|null;reason?:string;reference_id?:string;basis?:string;purchase?:RecipePurchase|null;unit?:string};
// Purchase amounts are per stated package, never per the spreadsheet column heading.
export function purchaseUnitPrice(p:RecipePurchase|null|undefined,target:string):number|null{
 if(!target.trim()||!p?.unit?.trim()||!p||!Number.isFinite(p.amount)||p.amount<0||!Number.isFinite(p.quantity)||p.quantity<=0)return null;
 let denominator=p.quantity*recipeFactor(p.unit);
 if(recipeUnit(p.unit)!==recipeUnit(target)){
  if(!p.content_quantity||p.content_quantity<=0||recipeUnit(p.content_unit||'')!==recipeUnit(target))return null;
  denominator=p.quantity*p.content_quantity*recipeFactor(p.content_unit||'');
 }
 return p.amount/denominator*recipeFactor(target);
}
export function applyCostQuotes(rows:SheetRow[],quotes:CostQuote[]){
 if(rows.length!==quotes.length)throw Error('價格回應不完整，請重試。');
 return rows.map((r,i)=>{const q=quotes[i],valid=q.price!==null&&Number.isFinite(q.price)&&q.price>=0;
  return {...r,requestId:r.requestId||crypto.randomUUID(),values:{...r.values,...(valid?{price:String(q.price),amount:r.values.quantity!==''?String(Math.round((Number(r.values.quantity)*q.price!+Number.EPSILON)*100)/100):'',purchase_price:String(q.purchase?q.purchase.amount/q.purchase.quantity:q.price),price_unit:q.purchase?.unit||r.values.unit,content_quantity:q.purchase?.content_quantity?String(q.purchase.content_quantity):'',content_unit:q.purchase?.content_unit||'',purchase_specification:formatPurchaseSpecification(q.purchase?.content_quantity,q.purchase?.content_unit)}:{}),price_source:valid?[q.source,q.date].filter(Boolean).join(' · '):q.reason||'名稱或計價單位尚未完成對應'},meta:{...r.meta as object,costQuote:q}};
 });
}
/** Read-only hydration for catalog rows before a count exists. Never creates a count or replaces saved prices. */
export async function loadUncountedInventoryPrices(rows:SheetRow[],lookup:(items:{product_id:string;name:string;unit:string}[])=>Promise<CostQuote[]>){
 const targets=rows.filter(r=>r.state==='LIVE'&&!r.locked&&r.values.price===''&&r.values.quantity===''&&r.id.startsWith('catalog:'));
 const filled=new Map<string,SheetRow>();
 for(let start=0;start<targets.length;start+=100){
  const chunk=targets.slice(start,start+100);
  const quotes=await lookup(chunk.map(r=>({product_id:r.id.slice('catalog:'.length),name:r.values.name,unit:r.values.unit})));
  const priced=applyCostQuotes(chunk,quotes);
  priced.forEach((r,i)=>filled.set(r.id,{...chunk[i],values:{...r.values,amount:''}}));
 }
 return rows.map(r=>filled.get(r.id)||r);
}

/** Human-readable evidence travels with the saved operation, not a live price lookup. */
export function costBasisNote(values:Record<string,string>){
 const note=(values.note||'').replace(/\n?〔計價基準：[^〕]*〕/g,'').trim();
 if(!values.purchase_price||!values.price_unit)return note;
 const price=Number(values.purchase_price),content=Number(values.content_quantity);
 if(!Number.isFinite(price)||price<0)return note;
 return [note,`〔計價基準：${price}／${values.price_unit}${values.content_quantity&&Number.isFinite(content)&&content>0?`；內容量：${content}／${values.content_unit}`:''}〕`].filter(Boolean).join('\n');
}
export function restoreCostBasis(values:Record<string,string>){
 const match=values.note?.match(/〔計價基準：([\d.eE+-]+)／([^；〕]+)(?:；內容量：([\d.eE+-]+)／([^〕]+))?〕/);
 const fallback={purchase_price:values.price||'',price_unit:values.unit,content_quantity:'',content_unit:'',...values};
 if(!match)return fallback;
 const [ ,amount,unit,content,contentUnit]=match;
 const converted=purchaseUnitPrice({amount:Number(amount),quantity:1,unit,...(content?{content_quantity:Number(content),content_unit:contentUnit}:{})},values.unit);
 if(values.price!==''&&(converted===null||Math.abs(converted-Number(values.price))>Math.max(1,Math.abs(converted))*1e-9))return fallback;
 return {...fallback,purchase_price:amount,price_unit:unit,content_quantity:content||'',content_unit:contentUnit||'',purchase_specification:formatPurchaseSpecification(content,contentUnit),note:values.note.replace(/\n?〔計價基準：[^〕]*〕/g,'').trim()};
}
