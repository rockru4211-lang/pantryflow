import type {ReviewAccount} from './receipt-review';
/** Saved entry is sufficient; missing prices do not send users back through a status page. */
export function receiptEntryDestination(row:ReviewAccount){
 return row.lines.length>0&&(row.entry_completed||row.edit_revision>0||row.reviewed||row.finance_sent_at||row.received_at||row.receipt_status==='COMPLETED')?'items':'entry';
}
export function receiptEntryPage(page:string,backOffice:boolean){return backOffice&&['status','review','published'].includes(page)?'list':page;}
