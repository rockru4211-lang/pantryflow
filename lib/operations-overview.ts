import {repairStates,type RepairJob} from './equipment-workflow.ts';
import {historicalRepair,repairCreatedDate} from './repair-history.ts';
import {purchaseStates,type PurchaseNote} from './purchase-notes.ts';
import {ingredientPackageKey,priceCandidate,type PriceSheetData,type PriceSource} from './ingredient-price-sheet.ts';
import {contractDue,type AdministrativeRow} from './administrative-directory.ts';
import {recipeDisplayName,recipeFactor,type RecipeCard,type RecipePurchase} from './recipe-model.ts';
import {spotDifference,type SpotCheck} from './spot-checks.ts';
function validPurchase(value:RecipePurchase|null|undefined):value is RecipePurchase{
 return !!value&&Number.isFinite(value.amount)&&value.amount>=0&&Number.isFinite(value.quantity)&&value.quantity>0&&!!value.unit?.trim();
}

function sourcePurchase(source:PriceSource|undefined):RecipePurchase|null{
 if(validPurchase(source?.receipt_purchase))return source.receipt_purchase;
 if(source?.receipt_price!=null&&source.receipt_unit){
  const receipt={amount:source.receipt_price,quantity:1,unit:source.receipt_unit};
  if(validPurchase(receipt))return receipt;
 }
 return validPurchase(source?.purchase)?source.purchase:null;
}

export function overviewPriceRises(data:PriceSheetData){
 return data.ingredients.flatMap(row=>{
  const candidate=priceCandidate(row,data.supply_states);
  const oldCost=Number(row.cost_price);
  if(!candidate||candidate.price==null||oldCost<=0||!Number.isFinite(oldCost)||!Number.isFinite(candidate.price)||candidate.price<=oldCost)return [];
  const previous=validPurchase(row.purchase)?row.purchase:sourcePurchase(row.sources?.find(source=>source.id===row.selected_reference));
  const current=sourcePurchase(candidate);
  const comparable=previous&&current&&previous.quantity===current.quantity&&recipeFactor(previous.unit)===recipeFactor(current.unit)&&ingredientPackageKey(previous)===ingredientPackageKey(current);
  const purchasePercent=comparable&&previous.amount>0?(current.amount-previous.amount)/previous.amount*100:null;
  if(purchasePercent!==null&&purchasePercent<=0)return [];
  const purchaseStatus=!previous||!current?'進價資料不足':!comparable?'規格待核對':previous.amount===0?'原進價為零':'';
  return [{id:row.id,name:row.name,previous,current,purchasePercent,purchaseStatus}];
 }).sort((a,b)=>(b.purchasePercent??0)-(a.purchasePercent??0));
}
export function overviewContracts(rows:AdministrativeRow[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})){
 return rows.filter(r=>contractDue(r,today)).sort((a,b)=>a.contract_end!.localeCompare(b.contract_end!)).map(r=>({...r,days:Math.round((Date.parse(r.contract_end!)-Date.parse(today))/86400000)}));
}

export const OVERVIEW_LIMIT=5;
// Compare after merging stores so one store cannot crowd out higher-priority work.
export function prioritizeOverviewRows<T extends {id:string;storeId:string;priority?:number;order?:string}>(rows:T[]):T[]{
 return [...rows].sort((a,b)=>(a.priority??0)-(b.priority??0)||
  (a.order||'9999').localeCompare(b.order||'9999')||a.storeId.localeCompare(b.storeId)||a.id.localeCompare(b.id));
}

export type OverviewTask={id:string;name:string;detail:string;status:string;view:'equipment'|'purchase-notes'|'incidents'|'recipes';taskKind:'repair'|'purchase'|'recipe';priority:number;order?:string;recordId?:string};
export function overviewTasks(jobs:RepairJob[],purchases:PurchaseNote[],incidents:{id:string;category:string|null;status:string;title:string;created_at:string}[]=[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})):OverviewTask[]{
 const priority=(date:string|undefined,waiting:boolean)=>date&&date<today?0:waiting?2:1;
 const repairs:OverviewTask[]=jobs.filter(j=>j.status!=='DONE'&&!historicalRepair(repairCreatedDate(j.created_at))).map(j=>{
  const date=j.scheduled_at?repairCreatedDate(j.scheduled_at):undefined;
  return {id:`repair:${j.id}`,name:j.name,detail:date||'尚未安排',status:repairStates[j.status]+(j.last_report?`・${j.last_report}`:''),view:'equipment',taskKind:'repair',priority:priority(date,j.status==='QUOTE'),order:date};
 });
 const orders:OverviewTask[]=purchases.filter(p=>p.status==='PENDING'||p.status==='SENT').map(p=>{
  const date=p.arrival_date||p.desired_date||undefined;
  return {id:`purchase:${p.id}`,name:p.name,detail:date||'日期未定',status:purchaseStates[p.status],view:'purchase-notes',taskKind:'purchase',priority:priority(date,p.status==='SENT'),order:date};
 });
 const reports:OverviewTask[]=incidents.filter(r=>r.category==='設備'&&(r.status==='OPEN'||r.status==='IN_PROGRESS')).map(r=>({id:`incident:${r.id}`,name:r.title,detail:'尚未安排',status:r.status==='IN_PROGRESS'?'處理中':'待處理',view:'incidents',taskKind:'repair',priority:1}));
 return [...repairs,...orders,...reports];
}

export function overviewRecipeReviews(recipes:RecipeCard[]):OverviewTask[]{
 return recipes.filter(card=>card.document.lifecycle==='unset').map(card=>({
  id:`recipe:${card.id}`,recordId:card.id,name:recipeDisplayName(card.document),
  detail:'—',status:'待主管確認',view:'recipes',taskKind:'recipe',priority:1,order:card.updated_at,
 }));
}

export function overviewSpotDifferences(check:SpotCheck){
 if(check.status!=='OPEN'&&check.status!=='REVIEWING')return [];
 return check.items.flatMap(item=>{
  const difference=spotDifference(item);
  if(difference===null||difference===0||item.review_status==='SAME'||item.review_status==='CLOSED'||item.note?.trim()||item.reason&&item.reason!=='UNKNOWN')return [];
  const quantity=`${difference>0?'+':''}${difference} ${item.unit}`.trim();
  return [{
   id:`spot:${check.id}:${item.entry_id}`,recordId:check.id,name:item.zone?`${item.name}・${item.zone}`:item.name,
   detail:quantity,status:'待補差異原因',view:'spot-check' as const,priority:0,order:check.submitted_at||check.created_at,
  }];
 });
}
