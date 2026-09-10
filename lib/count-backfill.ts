import {utils,type WorkBook} from 'xlsx';
import {parseInventoryWorkbook} from './inventory-import';
import {countExportRows,paperOrder,type CountResult} from './count-flow';

// This works on a copy. The uploaded original and its empty opening cells are never modified.
export function fillCountWorkbook(original:WorkBook,rows:CountResult[]){
 const book=structuredClone(original);const detections=parseInventoryWorkbook(book).sheets;
 const unmatched:CountResult[]=[];
 for(const name of book.SheetNames){
  const sheet=book.Sheets[name];const detection=detections.find(s=>s.sheetName===name);
  const matching=rows.filter(r=>r.sheet_name===name&&r.source_row&&r.source_row>0);
  if(!detection?.headerRow){unmatched.push(...matching);continue;}
  const header=detection.headerRow-1;const range=utils.decode_range(sheet['!ref']||'A1');let column=-1;
  for(let c=range.s.c;c<=range.e.c;c++){const value=String(sheet[utils.encode_cell({r:header,c})]?.v||'').replace(/\s/g,'');if(['實盤數量','盤點數量','本次數量','實盤'].includes(value)){column=c;break;}}
  if(column<0)column=range.e.c+1;
  sheet[utils.encode_cell({r:header,c:column})]={t:'s',v:'實盤數量'};
  const groups=new Map<number,CountResult[]>();
  for(const row of matching){const line=row.source_row!;groups.set(line,[...(groups.get(line)||[]),row]);}
  for(const[line,items]of groups){
   if(new Set(items.map(r=>r.unit)).size!==1||new Set(items.map(r=>r.product_id)).size!==1){unmatched.push(...items);continue;}
   sheet[utils.encode_cell({r:line-1,c:column})]={t:'n',v:items.reduce((n,r)=>n+Number(r.quantity),0)};
   range.e.r=Math.max(range.e.r,line-1);
  }
  range.e.c=Math.max(range.e.c,column);sheet['!ref']=utils.encode_range(range);
 }
 unmatched.push(...rows.filter(r=>!r.sheet_name||!book.SheetNames.includes(r.sheet_name)||!r.source_row));
 return {book,unmatched};
}
export function addUnmatchedSheet(book:WorkBook,rows:CountResult[],management:boolean){if(rows.length)utils.book_append_sheet(book,utils.json_to_sheet(countExportRows(paperOrder(rows),management)),'新增或未對應',true);}
