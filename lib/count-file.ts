import {supabase} from './supabase-browser';
import {countExportRows,paperOrder,type CountResult} from './count-flow';
import {fillCountWorkbook,addUnmatchedSheet} from './count-backfill';
import {readInventoryWorkbook} from './inventory-import';
export async function downloadCountFile(sessionId:string,rows:CountResult[],management:boolean,format:'xlsx'|'csv'){
 const XLSX=await import('xlsx');const ordered=paperOrder(rows);
 if(format==='csv'||!management){
  const values=countExportRows(ordered,management).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?`'${v}`:v])));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(values),'盤點明細');
  XLSX.writeFile(book,`盤點-${sessionId.slice(0,8)}.${format}`,{bookType:format});return;
 }
 const session=await supabase.from('inventory_count_sessions').select('store_id').eq('id',sessionId).single();if(session.error||!session.data?.store_id)throw Error('COUNT_SOURCE_UNAVAILABLE');
 const files=await supabase.from('inventory_import_files').select('original_filename,storage_path,created_at').eq('store_id',session.data.store_id).order('created_at');if(files.error)throw files.error;
 const output=XLSX.utils.book_new();const unmatched:CountResult[]=[];const remaining=new Set(ordered.map(r=>r.id));
 for(const file of files.data||[]){
  const selected=ordered.filter(r=>remaining.has(r.id)&&r.file_name===file.original_filename&&(!r.file_order||new Date(r.file_order).getTime()===new Date(file.created_at).getTime()));if(!selected.length)continue;
  const original=await supabase.storage.from('inventory-imports').download(file.storage_path);if(original.error)throw original.error;
  const {book,unmatched:missing}=fillCountWorkbook(readInventoryWorkbook(await original.data.arrayBuffer(),file.original_filename),selected);
  for(const name of book.SheetNames)XLSX.utils.book_append_sheet(output,book.Sheets[name],name,true);
  unmatched.push(...missing);for(const row of selected)remaining.delete(row.id);
 }
 unmatched.push(...ordered.filter(r=>remaining.has(r.id)));addUnmatchedSheet(output,unmatched,true);
 if(!output.SheetNames.length)throw Error('COUNT_SOURCE_UNAVAILABLE');
 XLSX.utils.book_append_sheet(output,XLSX.utils.json_to_sheet(countExportRows(ordered,true)),'完整盤點明細',true);
 XLSX.writeFile(output,`盤點回填-${sessionId.slice(0,8)}.xlsx`);
}
