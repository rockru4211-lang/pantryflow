import {parsePurchaseSpecification,usesPackageSpecification,validatePurchaseSpecification} from './purchase-specification.ts';
export {formatPurchaseSpecification,usesPackageSpecification} from './purchase-specification.ts';
import {recipePurchaseDisplay,normalizeRecipePurchase,recipeUnit,type RecipePurchase} from './recipe-model.ts';
export type IngredientAlias={id:string;name:string;unit:string;specification:string;corrected:boolean};
export type IngredientMaster={id:string;name:string;unit:string;cost_price:number|null;selected_reference:string|null;review_status:'confirmed'|'pending';revision:number;aliases:IngredientAlias[];source?:string;source_kind?:string;effective_date?:string|null;manual?:boolean;purchase?:RecipePurchase|null};
export type IngredientCatalog={ingredients:IngredientMaster[];can_price:boolean};
export type IngredientSource={id:string;name:string;unit:string;price:number|null;source:string;source_kind?:string;effective_date:string|null;review_status:string;source_ref?:{url?:string;supplier_name?:string;review_note?:string;specification?:string};purchase?:{amount:number;quantity:number;unit:string}|null};
export type IngredientDraft={name:string;unit:string;price:string;reference:string;specification?:string;content?:string;contentUnit?:string;effective_date?:string;change_reason?:string};
export function ingredientPurchase(row?:IngredientMaster){
 const p=row?.purchase?recipePurchaseDisplay(row.purchase):null;
 if(!p||!Number.isFinite(p.amount)||!Number.isFinite(p.quantity)||p.quantity<=0||p.amount<0||!p.unit)return null;
 return {...p,amount:p.amount/p.quantity,quantity:1};
}
export const ingredientDraft=(row?:IngredientMaster):IngredientDraft=>{
 const p=ingredientPurchase(row);
 return {name:row?.name||'',unit:p?.unit||row?.unit||'待補單位',price:p?String(p.amount):row?.cost_price==null?'':String(row.cost_price),reference:row?.selected_reference||'',content:p?.content_quantity?String(p.content_quantity):'',contentUnit:p?.content_unit||'g'};
};
export const ingredientConversionPending=(row:IngredientMaster)=>['包','瓶','罐','盒','袋','箱','桶'].includes(ingredientPurchase(row)?.unit||row.unit)&&!ingredientPurchase(row)?.content_quantity;
export function ingredientMatches(row:IngredientMaster,term:string){return [row.name,...row.aliases.flatMap(a=>[a.name,a.specification])].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export const ingredientPending=(row:IngredientMaster)=>row.cost_price===null||row.review_status==='pending'||ingredientConversionPending(row);
export function ingredientSourceLabel(row:Pick<IngredientMaster,'source'|'source_kind'|'manual'|'selected_reference'|'cost_price'>){
 if(row.manual&&!row.selected_reference)return '人工設定';
 if(row.source?.includes('已核對進貨'))return '進貨明細';
 if(row.source?.startsWith('請購表'))return '請購表';
 if(row.source_kind==='history')return '過去食譜成本表';
 return row.source|| (row.cost_price===null?'尚無資料':'既有資料');
}
export function ingredientSourcePriority(source?:string,kind?:string){return source?.includes('已核對進貨')?0:source?.startsWith('請購表')||kind==='purchase'?1:kind==='history'?2:3;}
export function ingredientSaveData(draft:IngredientDraft,row?:IngredientMaster){
 if(!draft.name.trim())throw Error('請填食材名稱。');
 if(!draft.unit.trim())throw Error('請選計價單位。');
 const cost=draft.price.trim()===''?null:Number(draft.price);
 if(cost!==null&&(!Number.isFinite(cost)||cost<0))throw Error('成本單價需為零或正數；尚未確認可留白。');
 if(draft.specification!==undefined){validatePurchaseSpecification(draft.specification);const spec=usesPackageSpecification(draft.unit)?parsePurchaseSpecification(draft.specification):null;draft={...draft,content:spec?.quantity||'',contentUnit:spec?.unit||''};}
 const content=draft.content?.trim()?Number(draft.content):null;
 if(content!==null&&(!Number.isFinite(content)||content<=0))throw Error('包裝內容量需大於零；尚未確認可留白。');
 const original=ingredientPurchase(row);
 const purchase:RecipePurchase|null=cost===null?null:{amount:cost,quantity:1,unit:draft.unit,...(original?.cost_unit_price!==undefined&&cost===original.amount&&draft.unit===original.unit?{cost_unit_price:original.cost_unit_price}:{}),...(content!==null?{content_quantity:content,content_unit:draft.contentUnit||'g',conversion_basis:'package'}:{})};
 const target=content!==null?draft.contentUnit||'g':draft.unit;
 const normalized=purchase?normalizeRecipePurchase(purchase,target):null;
 return {effective_date:draft.effective_date||new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:draft.change_reason||'確認標準進價',id:row?.id,revision:row?.revision,name:draft.name.trim(),unit:normalized?.unit||recipeUnit(draft.unit),cost_price:normalized?.costPrice??normalized?.price??null,selected_reference:draft.reference||null,purchase};
}
