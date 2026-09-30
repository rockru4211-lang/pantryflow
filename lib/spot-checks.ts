import type {WorkEntry} from './workflow-rules';

export type SpotCaps={plan:boolean;operate:boolean;review:boolean;close:boolean;export:boolean};
export type SpotSourceItem={entry_id:string;product_id:string;zone_id:string;name:string;supplier?:string;zone:string;unit:string;specification:string;original_entered_at:string|null;baseline_note:string};
export type SpotItem=SpotSourceItem & {original_quantity?:number|null;quantity:number|null;review_status:'UNCHECKED'|'SAME'|'PENDING'|'REVIEWED'|'CLOSED';recheck_quantity:number|null;reason:string|null;note:string;reviewed_by:string|null;reviewed_name:string|null;reviewed_at:string|null;confirmed_name:string|null;confirmed_at:string|null;final_quantity:number|null;return_note:string};
export type SpotSummary={id:string;store_id:string;source_id:string;source_month:string;source_completed_at:string|null;status:'DRAFT'|'OPEN'|'REVIEWING'|'CLOSED';assignee_id:string;assignee_name:string;created_name:string;created_at:string;submitted_at:string|null;submitted_name:string|null;closed_at:string|null;revision:number;total:number;pending_review:number;pending_close:number};
export type SpotEvent={id:string;entry_id:string|null;action:string;actor_name:string;at:string;payload:{before?:SpotItem;after?:SpotItem;published?:boolean}};
export type SpotCheck=SpotSummary & {caps:SpotCaps;items:SpotItem[];events:SpotEvent[]};
export type SpotList={caps:SpotCaps;checks:SpotSummary[]};
export type SpotCatalog={caps:SpotCaps;source_id:string|null;sources:{id:string;completed_at:string|null;started_at:string;status:'DRAFT'|'IN_PROGRESS'|'REVIEWING'|'CLOSED'}[];items:SpotSourceItem[];assignees:{id:string;name:string}[]};
export const spotReasons:Record<string,string>={USED:'期間已使用',MOVEMENT:'期間進貨／調撥',ORIGINAL_ERROR:'原盤點有誤',CHECK_ERROR:'抽查輸入有誤',OTHER:'其他原因',UNKNOWN:'原因待查'};
export const spotStatus:Record<string,string>={DRAFT:'清單草稿',OPEN:'待抽查',REVIEWING:'差異待確認',CLOSED:'已結案'};
export const spotItemStatus:Record<string,string>={UNCHECKED:'尚未送出',SAME:'數量一致',PENDING:'待主管複核',REVIEWED:'待行政確認',CLOSED:'已結案'};
export const spotActionLabel=(event:SpotEvent)=>({create:event.payload.published?'建立抽查清單':'儲存清單草稿',plan:event.payload.published?'發布抽查清單':'修改清單草稿',submit:'送出抽查',review:event.payload.after?.review_status==='REVIEWED'?'主管送出複核':'主管暫存',close:'行政確認結案',return:'退回補充'}[event.action]||event.action);
export function validSpotQuantity(value:string){return /^\d+(?:\.\d{1,3})?$/.test(value.trim())&&Number(value)>=0&&Number(value)<1e11;}
export function spotDifference(item:Pick<SpotItem,'quantity'|'original_quantity'>){return item.quantity==null||item.original_quantity==null?null:Number((Number(item.quantity)-Number(item.original_quantity)).toFixed(3));}
export function spotWorkEntries(checks:SpotSummary[]):WorkEntry[]{return checks.filter(c=>c.status!=='DRAFT').map(c=>({key:`spot:${c.id}`,id:c.id,category:'spot',title:`${c.source_month.slice(0,7)} 抽盤`,copy:c.status==='OPEN'?`${c.assignee_name}・待抽查`:c.status==='CLOSED'?'已結案':`${c.pending_review} 項待主管複核・${c.pending_close} 項待行政確認`,at:c.submitted_at||c.created_at,pending:c.status!=='CLOSED',target:'spot-check'}));}
export function spotError(error:unknown){const raw=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);const messages:Record<string,string>={SPOT_CHANGED:'共同紀錄已更新。您的輸入仍保留，請先重新讀取並核對。',SPOT_LOCKED:'這筆資料已送出或結案，請重新讀取目前進度。',SPOT_SOURCE_NOT_CLOSED:'盤點表已更新，請重新讀取。',SPOT_SOURCE_NOT_FOUND:'找不到這個門市的盤點表，請重新讀取。',SPOT_ITEM_OUT_OF_SCOPE:'盤點表品項已更新，請重新讀取後勾選。',SPOT_SELECT_ITEMS:'請至少勾選一項抽查品項。',SPOT_INVALID_ASSIGNEE:'抽查人員已無此店操作權限，請重新選擇。',SPOT_ASSIGNEE_REQUIRED:'請由清單指定的抽查人員填寫及送出。',SPOT_INCOMPLETE:'尚有品項未填數量，請完成後再送出。',SPOT_INVALID_QUANTITY:'請填寫有效數量，最多三位小數；沒有庫存請填 0。',SPOT_REASON_REQUIRED:'請填寫複核數量及已確認的原因；尚未查明可先暫存。',SPOT_REVIEW_REQUIRED:'請先由主管完成複核，再確認結案。',STORE_READ_ONLY:'目前僅可查看或匯出，不能修改抽盤資料。',APP_FORBIDDEN:'目前沒有此門市或這項操作的權限。'};return Object.entries(messages).find(([key])=>raw.includes(key))?.[1]||'作業尚未確認成功，輸入已保留。請確認連線後重試。';}

const excelTime=(iso:string|null|undefined)=>iso?(Date.parse(iso)+8*3600000-Date.UTC(1899,11,30))/86400000:null;
export function spotExportRows(checks:SpotCheck[],storeName:string){
 const details:Record<string,string|number|null>[]=[];const reviews:Record<string,string|number|null>[]=[];
 for(const check of checks){
  if(!check.submitted_at)continue;
  for(const item of check.items){
   if(item.original_quantity===undefined||item.quantity==null)throw Error('抽查匯出資料不完整，請重新讀取。');
   const common={'門市':storeName,'盤點月份':check.source_month.slice(0,7),'抽查清單編號':check.id,'原盤點完成時間':excelTime(check.source_completed_at),'抽查送出時間':excelTime(check.submitted_at),'儲物區':item.zone,'品項':item.name,'規格':item.specification,'單位':item.unit,'原盤點數':item.original_quantity==null?null:Number(item.original_quantity),'抽查數':Number(item.quantity),'差異數':spotDifference(item),'抽查人':check.submitted_name||check.assignee_name};
   details.push({...common,'處理狀態':spotItemStatus[item.review_status],'複核數':item.recheck_quantity==null?null:Number(item.recheck_quantity),'最後確認數':item.final_quantity==null?null:Number(item.final_quantity),'比對基準說明':item.baseline_note});
   if(item.review_status==='SAME')continue;
   const events=check.events.filter(e=>e.entry_id===item.entry_id&&['review','return','close'].includes(e.action));
   for(const event of events.length?events:[null]){
    const at=event?.payload.after||item;
    reviews.push({...common,'目前處理狀態':spotItemStatus[item.review_status],'紀錄':event?spotActionLabel(event):'差異待複核','當時處理狀態':spotItemStatus[at.review_status],'複核數':at.recheck_quantity==null?null:Number(at.recheck_quantity),'差異原因':spotReasons[at.reason||'']||'尚未確認','補充說明':at.note,'最後確認數':at.final_quantity==null?null:Number(at.final_quantity),'複核人':at.reviewed_name,'複核時間':excelTime(at.reviewed_at),'結案確認人':at.confirmed_name,'結案時間':excelTime(at.confirmed_at),'退回原因':at.return_note,'操作人':event?.actor_name||check.submitted_name||check.assignee_name,'操作時間':excelTime(event?.at||check.submitted_at)});
   }
  }
 }
 return {details,reviews};
}
// Runtime download uses the application's existing browser-compatible XLSX
// dependency. All user text remains a string cell, never an Excel formula.
export async function makeSpotWorkbook(checks:SpotCheck[],storeName:string){
 const XLSX=await import('xlsx');const rows=spotExportRows(checks,storeName);const workbook=XLSX.utils.book_new();
 for(const [name,data,emptyHeaders] of [['抽盤明細',rows.details,['門市','盤點月份','品項','單位','原盤點數','抽查數','差異數','處理狀態']],['差異處理紀錄',rows.reviews,['門市','品項','目前處理狀態','差異原因','補充說明','複核人','結案確認人']]] as const){
  const headers=data.length?Object.keys(data[0]):[...emptyHeaders];const sheet=XLSX.utils.json_to_sheet(data,{header:headers});
  sheet['!cols']=headers.map(key=>({wch:key.includes('編號')?38:/說明|原因/.test(key)?38:/時間/.test(key)?22:/品項/.test(key)?28:16}));
  sheet['!autofilter']={ref:sheet['!ref']||`A1:${XLSX.utils.encode_col(headers.length-1)}1`};
  headers.forEach((key,col)=>{for(let row=1;row<=data.length;row++){const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];if(cell?.t==='n')cell.z=key.includes('時間')?'yyyy/mm/dd hh:mm':'0.###';}});
  XLSX.utils.book_append_sheet(workbook,sheet,name);
 }return workbook;
}
export async function downloadSpotWorkbook(checks:SpotCheck[],storeName:string,month:string){const XLSX=await import('xlsx');XLSX.writeFile(await makeSpotWorkbook(checks,storeName),`${storeName.replace(/[\\/:*?"<>|]/g,'_')}_${month}_抽盤紀錄.xlsx`,{compression:true});}
