import {stableProductCode,type InventoryImportRow,type InventoryWorkbookParse} from './inventory-import';
export type ReviewStatus='PENDING'|'ADDED'|'EXISTING'|'FAILED'|'SKIPPED';
export type ReviewRow=InventoryImportRow&{status:ReviewStatus;reason:string;quantityText:string};
export type ImportSource={id?:string;original_filename:string;file_sha256:string;storage_path:string;sheet_names:string[]};
export const importStatusLabels:Record<ReviewStatus,string>={PENDING:'待確認',ADDED:'成功',EXISTING:'既有',FAILED:'失敗',SKIPPED:'略過'};
export const emptyReviewRow=(sheet:string,row:number):ReviewRow=>({sourceId:`${sheet}:${row}`,sheetName:sheet,sourceRow:row,name:'',unit:'',specification:'',supplierName:'',zoneName:'未分類',productCode:'',openingQuantity:null,generatedCode:true,missingFields:[],rawValues:{},mergedRanges:[],status:'PENDING',reason:'請確認後建立',quantityText:''});
export function reviewIssues(r:ReviewRow){return [!r.name.trim()&&'請補品名',(!r.unit.trim()||r.unit==='待補單位')&&'請補單位',r.quantityText.trim()!==''&&(!Number.isFinite(Number(r.quantityText))||Number(r.quantityText)<0)&&'數量須為非負數字，未提供可留白'].filter(Boolean).join('；');}
export function normalizeReview(r:ReviewRow){return {name:r.name,unit:r.unit,specification:r.specification,supplier:r.supplierName,zone:r.zoneName,product_code:r.productCode,opening_quantity:r.quantityText.trim()===''||!Number.isFinite(Number(r.quantityText))?null:Number(r.quantityText),quantity_input:r.quantityText};}
export function reviewPayload(r:ReviewRow){return {source_id:r.sourceId,sheet_name:r.sheetName,source_row:r.sourceRow,product_code:r.generatedCode?stableProductCode(r.name,r.specification,r.unit):r.productCode,name:r.name,specification:r.specification,count_unit:r.unit,supplier_name:r.supplierName,zone_name:r.zoneName||'未分類',opening_quantity:r.quantityText.trim()===''?null:Number(r.quantityText),generated_code:r.generatedCode,raw_values:r.rawValues,merged_ranges:r.mergedRanges};}
export function workbookReview(parsed:InventoryWorkbookParse):ReviewRow[]{
 const rows:ReviewRow[]=parsed.rows.map(r=>({...r,unit:r.unit==='待補單位'?'':r.unit,status:'PENDING',reason:r.issues?.join('；')||'請確認後建立',quantityText:r.quantityInput??(r.openingQuantity===null?'':String(r.openingQuantity))}));
 for(const f of parsed.failures)if(!rows.some(r=>r.sheetName===f.sheetName&&r.sourceRow===f.sourceRow))rows.push({...emptyReviewRow(f.sheetName,f.sourceRow),reason:f.reason});
 for(const r of parsed.skipped)rows.push({...emptyReviewRow(r.sheetName,r.sourceRow),status:'SKIPPED',reason:r.reason});
 return rows.sort((a,b)=>parsed.sheets.findIndex(s=>s.sheetName===a.sheetName)-parsed.sheets.findIndex(s=>s.sheetName===b.sheetName)||a.sourceRow-b.sourceRow);
}

// Preserve persisted outcomes and original sheet order when continuing an import.
export function restoreReviewRows(records:Record<string,unknown>[],sheets:string[]):ReviewRow[]{
 const rank=(sheet:string)=>{const index=sheets.indexOf(sheet);return index<0?sheets.length:index;};
 return records.map(r=>{const n=(r.normalized_values||{}) as Record<string,unknown>;const status=r.status as ReviewStatus;
 return {...emptyReviewRow(String(r.sheet_name),Number(r.source_row)),sourceId:String(r.source_id),name:String(n.name||''),unit:String(n.unit||''),specification:String(n.specification||''),supplierName:String(n.supplier||''),zoneName:String(n.zone||'未分類'),productCode:String(n.product_code||''),generatedCode:!n.product_code,rawValues:(r.raw_values||{}) as Record<string,string>,mergedRanges:Array.isArray(r.merged_ranges)?r.merged_ranges.map(String):[],quantityText:typeof n.quantity_input==='string'?n.quantity_input:n.opening_quantity==null?'':String(n.opening_quantity),status:r.product_id?(status==='ADDED'?'ADDED':'EXISTING'):['PENDING','FAILED','SKIPPED'].includes(status)?status:'PENDING',reason:String(r.reason||'')} as ReviewRow;
 }).sort((a,b)=>rank(a.sheetName)-rank(b.sheetName)||a.sheetName.localeCompare(b.sheetName)*(rank(a.sheetName)===sheets.length?1:0)||a.sourceRow-b.sourceRow||a.sourceId.localeCompare(b.sourceId));
}
export function restoreReviewEdits(rows:ReviewRow[],drafts:Record<string,Partial<ReviewRow>>):ReviewRow[]{
 return rows.map(r=>{const d=drafts[r.sourceId];if(!d||!['PENDING','FAILED'].includes(r.status))return r;return {...r,name:d.name??r.name,unit:d.unit??r.unit,quantityText:d.quantityText??r.quantityText,zoneName:d.zoneName??r.zoneName,specification:d.specification??r.specification,supplierName:d.supplierName??r.supplierName,status:'PENDING'};});
}
