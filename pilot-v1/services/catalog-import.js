export const CATALOG_COLUMNS=['product_code','name','count_unit','purchase_unit','opening_quantity'];
export const CATALOG_TEMPLATE='product_code,name,count_unit,purchase_unit,opening_quantity\nHAM-001,火腿,包,箱,10\n';

export function validateCatalogRows(rows){
  const seen=new Set();
  return rows.map((raw,index)=>{
    const row=Object.fromEntries(CATALOG_COLUMNS.map(key=>[key,String(raw[key]??'').trim()]));
    const errors=[];
    for(const key of CATALOG_COLUMNS)if(row[key]==='')errors.push({row:index+2,field:key,message:'必填欄位不可空白'});
    const quantity=Number(row.opening_quantity);
    if(row.opening_quantity!==''&&(!Number.isFinite(quantity)||quantity<0))errors.push({row:index+2,field:'opening_quantity',message:'必須為 0 或正數'});
    const code=row.product_code.toUpperCase();
    if(code&&seen.has(code))errors.push({row:index+2,field:'product_code',message:'檔案內商品編碼重複'});
    seen.add(code); row.product_code=code; row.opening_quantity=quantity;
    return{row,errors};
  });
}

function parseCsv(text){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);const headers=lines.shift()?.split(',').map(x=>x.trim())||[];return lines.map(line=>Object.fromEntries(headers.map((key,i)=>[key,line.split(',')[i]??''])))}

export async function parseCatalogFile(file){
  const extension=file.name.split('.').pop()?.toLowerCase();
  let rows;
  if(extension==='csv')rows=parseCsv(await file.text());
  else{
    if(!globalThis.XLSX)throw new Error('EXCEL_PARSER_NOT_READY');
    const workbook=globalThis.XLSX.read(await file.arrayBuffer(),{type:'array'});
    rows=globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{defval:''});
  }
  const checked=validateCatalogRows(rows),errors=checked.flatMap(x=>x.errors);
  return{rows:checked.map(x=>x.row),errors};
}
