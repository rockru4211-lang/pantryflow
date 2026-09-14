import {utils} from 'xlsx';
import {findInventoryField,parseInventoryWorkbook,type InventoryWorkbookParse} from './inventory-import';
export type PdfTextItem={str:string;x:number;y:number};
export function pdfTextMatrix(items:PdfTextItem[]) {
 const lines:PdfTextItem[][]=[];
 for(const item of [...items].sort((a,b)=>b.y-a.y||a.x-b.x)){if(!item.str.trim())continue;const line=lines.find(l=>Math.abs(l[0].y-item.y)<3);if(line)line.push(item);else lines.push([item]);}
 lines.forEach(l=>l.sort((a,b)=>a.x-b.x));
 const header=lines.find(l=>l.some(i=>findInventoryField(i.str)==='name')&&l.some(i=>findInventoryField(i.str)==='unit'));
 if(!header)return null;
 const columns=header.filter(i=>findInventoryField(i.str));
 return lines.map(line=>{const cells=columns.map(()=>[] as string[]);for(const item of line){let c=0;while(c+1<columns.length&&item.x>=(columns[c].x+columns[c+1].x)/2)c++;cells[c].push(item.str);}return cells.map(c=>c.join(' ').trim());});
}
export function parsePdfTextPages(pages:PdfTextItem[][]):InventoryWorkbookParse|null {
 const workbook=utils.book_new();for(let i=0;i<pages.length;i++){const matrix=pdfTextMatrix(pages[i]);if(!matrix)return null;utils.book_append_sheet(workbook,utils.aoa_to_sheet(matrix),`第 ${i+1} 頁`);}return parseInventoryWorkbook(workbook);
}
