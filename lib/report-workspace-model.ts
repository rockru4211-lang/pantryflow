import type {receiptPriceSummary} from './receipt-price-summary';

export type ReportSection='reports'|'exports'|'costs'|'audit';
export type ReportInitialPage='home'|'counts';
export type ReportAuditEvent={id:string;action:string;actor_name:string|null;entity_type:string;entity_id:string;old_value:unknown;new_value:unknown;created_at:string};
export type ReportMenuItem=readonly [page:string,label:string,description:string];

export function reportMenu(section:ReportSection,canManage:boolean,canOpenWaste:boolean):ReportMenuItem[]{
 if(section==='exports')return [
  ['counts','盤點回填版','保持來源位置，新品另表'],
  ...(canManage?[['audit','完整稽核明細','來源、操作者、時間與事件'] as const]:[]),
  ['summary','營運摘要','只包含已確認資料'],
 ];
 if(section==='costs')return [
  ['receipts','進貨金額','已確認貨單金額，不代表實際耗用成本'],
  ['prices','進貨價格摘要','各品項與單位分開比較'],
  ...(canOpenWaste?[['waste','廢棄紀錄','查看所選月份的廢棄明細'] as const]:[]),
 ];
 if(section==='audit')return [
  ['counts','盤點事件','查看已記錄的盤點操作與更正'],
  ['receipts','進貨事件','查看已記錄的辨識、修正與確認'],
  ['events','權限異動','角色、代理與停用紀錄'],
  ['all','全部操作','查看本期所有已記錄事件'],
 ];
 return [['summary','營運摘要','門市與期間'],['counts','盤點報表','完整成果與完成時間'],['receipts','進貨報表','供應商與品項']];
}

export function reportAuditEvents(events:ReportAuditEvent[]|undefined,page:string){
 return (events||[]).filter(event=>{
  const action=event.action.toLowerCase(),entity=event.entity_type.toLowerCase();
  if(page==='counts')return /^(count[._]|zone[._])/.test(action)||/^(inventory_count_|count_|zone_product)/.test(entity);
  if(page==='receipts')return /^receipt[._]/.test(action)||/^(receipt_|goods_receipt)/.test(entity);
  if(page==='events')return /^(member[._]|delegation[._]|management_member_|staff[._]|access[._])/.test(action)||/^(store_membership|membership|staff_identity|role_delegation)/.test(entity);
  return page==='all';
 });
}

export function confirmedReceiptTotal(receipts:{total_inc_tax:number|null}[]|undefined):number|null{
 if(!receipts?.length||receipts.some(receipt=>receipt.total_inc_tax===null||receipt.total_inc_tax===undefined||!Number.isFinite(Number(receipt.total_inc_tax))))return null;
 return receipts.reduce((sum,receipt)=>sum+Number(receipt.total_inc_tax),0);
}

export function reportPriceRows(prices:ReturnType<typeof receiptPriceSummary>,storeName:string){
 return prices.map(price=>({門市:storeName,品名:price.name,單位:price.unit,最近進貨日期:price.latestDate,最近單價:price.latest,本期加權均價:price.weightedAverage===null?null:Math.round(price.weightedAverage*100)/100,最近供應商:price.supplier||null,來源貨單:price.source||null}));
}

export function reportEventLabel(action:string){
 const labels:Record<string,string>={
  'member.save':'成員權限更新','member.assign':'門市授權','delegation.create':'設定代理','delegation.revoke':'撤銷代理','settings.save':'更新作業設定','business.save':'商家資料更新','store.save':'門市資料更新','product.save':'商品資料更新','supplier.save':'供應商資料更新',
  COUNT_SESSION_CREATED:'建立盤點',COUNT_STARTED:'開始盤點',COUNT_SUBMITTED:'送出盤點',COUNT_CLOSED:'盤點結案',COUNT_STATE_CHANGED:'盤點狀態更新',COUNT_DRAFT_SAVED:'儲存盤點數量／備註',COUNT_ZONE_COMPLETED:'區域盤點完成',COUNT_SESSION_COMPLETED:'盤點完成',COUNT_PAPER_REVIEWED:'紙本覆核完成',COUNT_PAPER_COMPLETED:'紙本盤點完成',COUNT_DISCREPANCY_RESOLVED:'完成盤點差異處理',COUNT_CORRECTED:'盤點追加更正',ZONE_CONFIGURATION_SAVED:'儲物區設定更新',
  RECEIPT_CONFIRMED:'確認進貨',RECEIPT_REVIEW_SAVED:'儲存貨單修正',RECEIPT_PRODUCT_MAPPED:'確認貨單品項對應',RECEIPT_ERP_REPORTED:'完成 ERP 登記',RECEIPT_MANAGER_REVIEW_REQUIRED:'貨單待主管確認',RECEIPT_AUTO_PUBLISHED:'貨單自動發布',RECEIPT_REVIEW_PUBLISHED:'貨單覆核發布','receipt.delivery':'更新到貨紀錄','receipt.erp-bulk':'批次完成 ERP 登記','receipt.edit-card':'修改貨單品項',
 };
 return labels[action]||action;
}
