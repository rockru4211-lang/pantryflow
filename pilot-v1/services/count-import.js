function cellText(value){
  if(value==null)return'';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if('result'in value)return cellText(value.result);
    if('text'in value)return cellText(value.text);
    if(Array.isArray(value.richText))return value.richText.map(part=>part.text||'').join('');
    if('hyperlink'in value)return cellText(value.text||value.hyperlink);
  }
  return String(value).trim();
}

function csvRows(text){
  const rows=[];let row=[],cell='',quoted=false;
  const source=String(text||'').replace(/^\ufeff/,'');
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(quoted&&char==='"'&&source[i+1]==='"'){cell+='"';i++;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(!quoted&&char===','){row.push(cell);cell='';continue}
    if(!quoted&&(char==='\n'||char==='\r')){if(char==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);row=[];cell='';continue}
    cell+=char;
  }
  row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);return rows;
}

const aliases={
  zone:/^(區域|區域名稱|儲物區|儲物區域|盤點區域|存放區域|儲位|庫別|倉別|位置)$/i,
  code:/^(商品編碼|品號|料號|貨號|產品編號|品項編號|商品代碼|code|sku)$/i,
  name:/^(商品名稱|食材名稱|原物料名稱|產品名稱|品項名稱|品名|品項|名稱|product)$/i,
  unit:/^(盤點單位|基本盤點單位|庫存單位|計量單位|基本單位|單位|count.?unit|unit)$/i,
  purchase:/^(進貨單位|採購單位|包裝單位|purchase.?unit)$/i,
  specification:/^(規格|包裝規格|商品規格|spec|specification)$/i,
  quantity:/^(盤點數量|實盤數量|本次數量|數量|quantity|qty)$/i
};
function normalizeHeader(value){return cellText(value).replace(/[\s　:：_\-()（）]/g,'')}
function columnMap(row){const normalized=row.map(normalizeHeader),map={};for(const[key,pattern]of Object.entries(aliases)){const index=normalized.findIndex(value=>pattern.test(value));if(index>=0)map[key]=index}return map}
function findHeader(rows){let best=null;for(let index=0;index<Math.min(rows.length,40);index++){const map=columnMap(rows[index]),score=['code','name','unit','zone','purchase','specification','quantity'].filter(key=>map[key]!=null).length;if(!best||score>best.score)best={index,map,score}}return best}
function rowsForSheet(sheet){const rows=[];sheet.eachRow({includeEmpty:true},row=>{const values=[];for(let index=1;index<=Math.max(sheet.actualColumnCount,row.cellCount);index++)values.push(cellText(row.getCell(index).value));rows.push(values)});return rows}
function workbookRows(workbook){let best=null;for(const sheet of workbook.worksheets){if(!sheet.actualRowCount)continue;const rows=rowsForSheet(sheet),header=findHeader(rows),score=header?.score||0;if(!best||score>best.score)best={sheetName:sheet.name||'工作表1',rows,score}}return best||{sheetName:'工作表1',rows:[]}}
function hashCode(value){let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(36).toUpperCase()}
function generatedProductCode(name){return`AUTO-${hashCode(name).slice(0,8)}`}
function inferredUnit(...values){const text=values.filter(Boolean).join(' '),match=text.match(/(?:\d+(?:\.\d+)?\s*)?(公斤|公克|毫升|公升|kg|ml|g|l|瓶|包|盒|箱|罐|顆|個|支|袋|桶|盤|條|片|份|組)(?=$|[\s/／*×xX()（）\d])/i);return match?.[1]||'個'}

export async function parseCountImportFile(file,knownProducts=[]){
  if(!file)throw new Error('COUNT_IMPORT_FILE_REQUIRED');
  if(file.size>10*1024*1024)throw new Error('COUNT_IMPORT_FILE_TOO_LARGE');
  const lower=file.name.toLowerCase();let source;
  if(lower.endsWith('.csv'))source={sheetName:'CSV',rows:csvRows(await file.text())};
  else if(lower.endsWith('.xlsx')){
    if(!window.ExcelJS)throw new Error('EXCEL_LIBRARY_UNAVAILABLE');
    const workbook=new window.ExcelJS.Workbook();
    try{await workbook.xlsx.load(await file.arrayBuffer())}catch{throw new Error('COUNT_IMPORT_EXCEL_INVALID')}
    source=workbookRows(workbook);
  }else throw new Error('COUNT_IMPORT_FILE_TYPE');
  const header=findHeader(source.rows);
  if(!header||header.score<1||(header.map.code==null&&header.map.name==null))throw new Error('COUNT_IMPORT_HEADERS_REQUIRED');
  const quantityColumn=(header.map.quantity??source.rows[header.index].length)+1;
  const known=new Set(knownProducts.map(item=>String(item.product_code||item).trim().toUpperCase())),seen=new Set;
  const rows=[];let matched=0,unmatched=0,duplicates=0,missingUnit=0,generatedCodes=0,defaultZones=0,invalid=0;
  for(let index=header.index+1;index<source.rows.length;index++){
    const cells=source.rows[index].map(cellText),sourceCode=header.map.code==null?'':cellText(cells[header.map.code]).toUpperCase(),sourceName=header.map.name==null?'':cellText(cells[header.map.name]);
    if(!sourceCode&&!sourceName)continue;
    const name=sourceName||sourceCode,baseCode=sourceCode||generatedProductCode(name),sourceUnit=header.map.unit==null?'':cellText(cells[header.map.unit]),specification=header.map.specification==null?'':cellText(cells[header.map.specification]),unit=sourceUnit||inferredUnit(name,specification),sourceZone=header.map.zone==null?'':cellText(cells[header.map.zone]),zoneName=sourceZone||'未分類區',purchaseUnit=(header.map.purchase==null?'':cellText(cells[header.map.purchase]))||unit,duplicateKey=`${baseCode}|${zoneName.toLowerCase()}`,isRepeated=seen.has(duplicateKey),code=isRepeated?`${baseCode}-R${index+1}`:baseCode;
    if(!sourceCode)generatedCodes++;if(!sourceUnit)missingUnit++;if(!sourceZone)defaultZones++;
    if(isRepeated)duplicates++;else seen.add(duplicateKey);
    if(!isRepeated&&known.has(baseCode))matched++;else unmatched++;
    if(!name)invalid++;
    rows.push({sheet:source.sheetName,sourceRow:index+1,sourceValues:cells,quantityColumn,zoneName,productCode:code,productName:name,unit,purchaseUnit});
  }
  if(!rows.length)throw new Error('COUNT_IMPORT_ROWS_REQUIRED');
  return{file,fileName:file.name,mimeType:file.type||(/\.csv$/i.test(file.name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),sheetName:source.sheetName,templateVersion:'PF-COUNT-IMPORT-V2-AUTO',headers:source.rows[header.index].map(cellText),headerRow:header.index+1,rows,counts:{matched,unmatched,duplicates,missingUnit,generatedCodes,defaultZones,invalid},canPublish:invalid===0};
}

export async function downloadCountWorkbook(rows,sessionId){
  if(!window.ExcelJS)throw new Error('EXCEL_LIBRARY_UNAVAILABLE');
  const workbook=new window.ExcelJS.Workbook(),groups=new Map;
  for(const row of rows){const key=row.來源工作表||'盤點表';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  for(const[sheetName,items]of groups){const sheet=workbook.addWorksheet(String(sheetName).slice(0,31));for(const item of items){const source=Array.isArray(item.來源原列)?item.來源原列:[];source.forEach((value,index)=>{sheet.getCell(Number(item.來源列號),index+1).value=value});sheet.getCell(Number(item.來源列號),Number(item.數量欄位)).value=Number(item.數量)}}
  const buffer=await workbook.xlsx.writeBuffer(),link=document.createElement('a');link.href=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));link.download=`PantryFlow_盤點原位置回填_${sessionId}.xlsx`;link.click();URL.revokeObjectURL(link.href);
}
