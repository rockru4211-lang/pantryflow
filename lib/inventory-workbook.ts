import type * as Excel from 'xlsx';
import type {CountIngredientName} from './ingredient-usage-names.ts';
import type {InventoryRow} from './inventory-monthly.ts';
import {restoreCostBasis} from './cost-price.ts';
import {formatPurchaseSpecification} from './purchase-specification.ts';
import {supplierCategory} from './supplier-categories.ts';
import {supplierNameIndex,supplierNameKey,type SupplierNameEntry} from './supplier-prices.ts';

export type InventoryExportLine=Pick<InventoryRow,'row_key'|'product_id'|'name'|'supplier'|'category'|
 'unit'|'current_quantity'|'unit_price'|'amount'|'price_purchase'|'review_note'>;

const headers=['食材編碼','品名','實盤數量','單位','進價（元）','計價單位','庫存金額（元）','核對狀態','資料編號','原匯出進價','原匯出計價單位','包裝規格'];
const missingSupplier='供應商待確認';
const categories=['食材','酒水','耗材','待分類'];
type Cell=string|number|null;
const numberOrBlank=(value:unknown)=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;

function quotation(line:InventoryExportLine):[number|null,string,string]{
 const purchase=line.price_purchase;
 if(purchase&&Number.isFinite(purchase.amount)&&purchase.amount>=0&&Number.isFinite(purchase.quantity)&&purchase.quantity>0&&purchase.unit?.trim()){
  return [purchase.amount/purchase.quantity,purchase.unit.trim(),formatPurchaseSpecification(purchase.content_quantity,purchase.content_unit)];
 }
 const basis=restoreCostBasis({price:line.unit_price==null?'':String(line.unit_price),unit:line.unit,note:line.review_note});
 return [numberOrBlank(basis.purchase_price),basis.price_unit||line.unit,formatPurchaseSpecification(basis.content_quantity,basis.content_unit)];
}

/** Read the grouped format without treating group headings or totals as inventory records. */
export function groupedInventoryImport(XLSX:typeof Excel,book:Excel.WorkBook){
 const sheets=book.SheetNames.map(name=>book.Sheets[name]).filter(sheet=>sheet.A1?.v===headers[0]&&sheet.J1?.v===headers[9]);
 if(!sheets.length)return null;
 return sheets.flatMap(sheet=>XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:true})
  .filter(row=>row['資料編號'])
  .map(row=>{
   const currentPrice=row['進價（元）']===''?null:row['進價（元）'];
   const currentUnit=String(row['計價單位']).trim();
   const priceEdited=currentPrice!==numberOrBlank(row['原匯出進價'])||currentUnit!==row['原匯出計價單位'];
   return {
    '資料編號':row['資料編號'],'品名':row['品名'],'單位':row['單位'],'實盤數量':row['實盤數量'],
    ...(priceEdited?{'進價':row['進價（元）'],'計價規格':currentUnit,'包裝規格':row['包裝規格']}:{}),
   };
  }));
}

export function appendInventoryWorkbook(XLSX:typeof Excel,book:Excel.WorkBook,lines:InventoryExportLine[],
 identities:CountIngredientName[],suppliers:SupplierNameEntry[]){
 const codes=new Map(identities.map(item=>[item.product_id,item.code.trim()]));
 const names=supplierNameIndex(suppliers);
 const groupsByCategory=new Map<string,Map<string,{name:string;lines:InventoryExportLine[]}>>();
 const seen=new Set<string>();
 for(const line of lines){
  if(seen.has(line.row_key))continue;
  seen.add(line.row_key);
  const key=supplierNameKey(line.supplier||'');
  const matches=names.get(key);
  const supplier=matches?.size===1?[...matches.values()][0]:undefined;
  const name=supplier?.name||line.supplier?.trim()||missingSupplier;
  const category=supplierCategory(line.category)||supplierCategory(supplier?.supplier_category)||'待分類';
  const groups=groupsByCategory.get(category)||new Map();
  const groupKey=supplier?.id||key;
  const group=groups.get(groupKey)||{name,lines:[]};
  group.lines.push(line);
  groups.set(groupKey,group);
  groupsByCategory.set(category,groups);
 }
 for(const category of categories){
  const groups=groupsByCategory.get(category);
  if(!groups&&lines.length)continue;
  const rows:Cell[][]=[[...headers]];
  const merges:Excel.Range[]=[];
  let cents=0,hasAmount=false;
  for(const group of [...(groups?.values()||[])].sort((a,b)=>
   Number(a.name===missingSupplier)-Number(b.name===missingSupplier)||a.name.localeCompare(b.name,'zh-Hant'))){
   merges.push({s:{r:rows.length,c:0},e:{r:rows.length,c:7}});
   rows.push([group.name]);
   group.lines.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')||a.unit.localeCompare(b.unit,'zh-Hant'));
   for(const line of group.lines){
    const code=codes.get(line.product_id);
    const [price,unit,specification]=quotation(line);
    const amount=numberOrBlank(line.amount);
    const status=[!code&&category!=='耗材'?'待對碼':'',!line.supplier?.trim()?'待確認供應商':'',
     (names.get(supplierNameKey(line.supplier||''))?.size??0)>1?'待核對供應商名稱':'',
     line.current_quantity===null?'未盤':amount===null?(price===null?'待補價':line.price_purchase?'待換算':'待核對計價'):''].filter(Boolean);
    rows.push([code||null,line.name,line.current_quantity,line.unit,price,unit,amount,status.join('、')||null,line.row_key,price,unit,specification]);
    if(amount!==null){cents+=Math.round(amount*100);hasAmount=true;}
   }
  }
  rows.push(['已計價小計',null,null,null,null,null,hasAmount?cents/100:null]);
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges']=merges;
  sheet['!cols']=[14,42,13,10,14,15,17,22,42,14,15,18].map((wch,i)=>({wch,hidden:i>=8}));
  for(let row=1;row<rows.length;row++){
   const price=sheet[XLSX.utils.encode_cell({r:row,c:4})];
   const amount=sheet[XLSX.utils.encode_cell({r:row,c:6})];
   if(price?.t==='n')price.z='#,##0.00####';
   if(amount?.t==='n')amount.z='#,##0.00';
  }
  XLSX.utils.book_append_sheet(book,sheet,category);
  if(!lines.length)break;
 }
}
