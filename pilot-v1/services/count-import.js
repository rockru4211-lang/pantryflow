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

function delimiterFor(text){
  const sample=String(text||'').split(/\r?\n/).slice(0,5).join('\n');
  const counts=[',','\t',';'].map(delimiter=>[delimiter,sample.split(delimiter).length-1]);
  counts.sort((a,b)=>b[1]-a[1]);
  return counts[0][1]?counts[0][0]:',';
}

function csvRows(text){
  const rows=[];let row=[],cell='',quoted=false;
  const source=String(text||'').replace(/^\ufeff/,''),delimiter=delimiterFor(source);
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(quoted&&char==='"'&&source[i+1]==='"'){cell+='"';i++;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(!quoted&&char===delimiter){row.push(cell);cell='';continue}
    if(!quoted&&(char==='\n'||char==='\r')){if(char==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);row=[];cell='';continue}
    cell+=char;
  }
  row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);return rows;
}

const aliases={
  zone:[/^(區域|儲物區|盤點區域|存放區域|位置|庫位)$/i],
  code:[/^(商品編碼|商品代碼|品號|貨號|產品編號|品項編號|code|sku)$/i],
  name:[/^(商品名稱|品名|品項名稱|品項|名稱|原料名稱|酒名|product)$/i],
  unit:[/^(盤點單位|計量單位|單位|count.?unit|unit)$/i],
  purchase:[/^(進貨單位|採購單位|purchase.?unit)$/i],
  supplier:[/^(廠商名稱|廠商|供應商|supplier|vendor)$/i],
  category:[/^(廠商類型|商品分類|品項分類|分類|類別|category)$/i],
  specification:[/^(規格|包裝規格|商品規格|spec|specification)$/i],
  quantity:[
    /^(盤點數量|實盤數量|本次數量|實際數量|counted.?quantity)$/i,
    /^(期末數量|月底數量|結存數量|ending.?quantity)$/i,
    /^(抽盤數量|複盤數量|recount.?quantity)$/i,
    /^(數量|quantity|qty)$/i
  ]
};
function normalizeHeader(value){return cellText(value).normalize('NFKC').replace(/[\s　:：_\-\/()（）]/g,'').toLowerCase()}
function columnMap(row){
  const normalized=row.map(normalizeHeader),map={};
  for(const[key,patterns]of Object.entries(aliases)){
    for(const pattern of patterns){const index=normalized.findIndex(value=>pattern.test(value));if(index>=0){map[key]=index;break}}
  }
  return map;
}
function headerScore(map){return(map.name!=null?6:0)+(map.unit!=null?2:0)+(map.code!=null?1:0)+(map.zone!=null?1:0)+(map.quantity!=null?2:0)+(map.supplier!=null?1:0)+(map.category!=null?1:0)+(map.specification!=null?1:0)}
function findHeader(rows){let best=null;for(let index=0;index<Math.min(rows.length,50);index++){const map=columnMap(rows[index]),score=headerScore(map);if(!best||score>best.score)best={index,map,score}}return best}

function workbookSources(workbook){
  const sources=[];
  for(const sheet of workbook.worksheets||[]){
    if(!sheet||!sheet.actualRowCount)continue;
    const rows=[];
    sheet.eachRow({includeEmpty:true},row=>{const values=[];for(let index=1;index<=Math.max(sheet.actualColumnCount,row.cellCount);index++)values.push(cellText(row.getCell(index).value));rows.push(values)});
    sources.push({sheetName:sheet.name||`工作表${sources.length+1}`,rows});
  }
  return sources;
}

function normalizedName(value){return cellText(value).normalize('NFKC').toLocaleLowerCase('zh-Hant').replace(/\s+/g,' ').trim()}
function normalizedCode(value){
  const code=cellText(value).normalize('NFKC').toUpperCase();
  return /^(無編碼|無代碼|無品號|N\/?A|NA|NONE|NULL|[-—–])$/i.test(code)?'':code;
}
function stableCode(name){
  let hash=2166136261;
  for(const char of normalizedName(name)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)}
  return`AUTO-${(hash>>>0).toString(16).toUpperCase().padStart(8,'0')}`;
}
function meaningfulSourceName(value){return!(/^(csv|sheet\s*\d+|工作表\s*\d+|worksheet\s*\d*)$/i.test(cellText(value)))}
function zoneCandidate(value){
  let text=cellText(value).normalize('NFKC').replace(/^>>\s*/,'').replace(/\.[^.]+$/,'');
  text=text.replace(/(?:19|20)?\d{2}[\/._\-年]\d{1,2}(?:[\/._\-月]\d{1,2}日?)?/g,' ').replace(/(?:19|20)\d{6}/g,' ');
  text=text.replace(/盤點表|盤點|inventory|count\s*sheet/gi,' ').replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();
  const parts=text.split(' ').filter(Boolean);
  return parts.at(-1)||'';
}
function defaultZone(source,fileName){
  const fromSheet=meaningfulSourceName(source.sheetName)?zoneCandidate(source.sheetName):'';
  return fromSheet||zoneCandidate(fileName)||'未分類區';
}
function inferUnit(cells,map,name){
  const explicit=cellText(cells[map.unit]);if(explicit)return{unit:explicit,inferred:false};
  const source=[cellText(cells[map.specification]),name].join(' ');
  const match=source.match(/(?:^|[\s(（])(?:\d+(?:\.\d+)?\s*)?(公斤|公克|kg|g|公升|毫升|ml|l|瓶|罐|包|盒|桶|袋|支|個|條|顆|片|份|箱)(?:[\s)）×x*]|$)/i);
  return{unit:match?.[1]||'個',inferred:true};
}

function knownIndexes(knownProducts){
  const byCode=new Map,byName=new Map;
  for(const item of knownProducts){
    const product=typeof item==='string'?{product_code:item}:item||{},code=normalizedCode(product.product_code),name=normalizedName(product.name);
    if(code)byCode.set(code,product);if(name&&!byName.has(name))byName.set(name,product);
  }
  return{byCode,byName};
}

export async function parseCountImportFile(file,knownProducts=[]){
  if(!file)throw new Error('COUNT_IMPORT_FILE_REQUIRED');
  if(file.size>10*1024*1024)throw new Error('COUNT_IMPORT_FILE_TOO_LARGE');
  const lower=file.name.toLowerCase();let sources;
  if(lower.endsWith('.csv'))sources=[{sheetName:'CSV',rows:csvRows(await file.text())}];
  else if(lower.endsWith('.xlsx')){
    if(typeof window==='undefined'||!window.ExcelJS)throw new Error('EXCEL_LIBRARY_UNAVAILABLE');
    const workbook=new window.ExcelJS.Workbook();
    try{await workbook.xlsx.load(await file.arrayBuffer())}catch{throw new Error('COUNT_IMPORT_EXCEL_INVALID')}
    sources=workbookSources(workbook);
  }else throw new Error('COUNT_IMPORT_FILE_TYPE');

  const known=knownIndexes(knownProducts),rows=[],seen=new Map,codeNames=new Map,headers={},usedSheets=[];
  let matched=0,unmatched=0,duplicates=0,missingUnit=0,invalid=0,conflicts=0,inferredCodes=0,inferredZones=0,skippedSheets=0;
  for(const source of sources){
    const header=findHeader(source.rows);
    if(!header||header.map.name==null||header.score<6){skippedSheets++;continue}
    headers[source.sheetName]=source.rows[header.index].map(cellText);usedSheets.push(source.sheetName);
    const sourceZone=defaultZone(source,file.name),quantityColumn=(header.map.quantity??source.rows[header.index].length)+1;
    for(let index=header.index+1;index<source.rows.length;index++){
      const cells=source.rows[index].map(cellText),name=cellText(cells[header.map.name]);
      if(!name)continue;
      if(/^(合計|總計|小計|折扣|備註|說明)$/i.test(name))continue;
      const explicitCode=normalizedCode(cells[header.map.code]),nameKey=normalizedName(name),knownByName=known.byName.get(nameKey),knownByCode=known.byCode.get(explicitCode);
      if(!explicitCode)inferredCodes++;
      let code=explicitCode||normalizedCode(knownByName?.product_code);
      if(!code)code=stableCode(name);
      const unitResult=inferUnit(cells,header.map,name),unit=unitResult.unit,purchaseUnit=cellText(cells[header.map.purchase])||unit;
      const explicitZone=cellText(cells[header.map.zone]),zoneName=explicitZone||sourceZone;
      if(!explicitZone)inferredZones++;if(unitResult.inferred)missingUnit++;
      const priorName=codeNames.get(code),knownName=cellText(knownByCode?.name);
      const hasConflict=Boolean((priorName&&normalizedName(priorName)!==nameKey)||(knownName&&normalizedName(knownName)!==nameKey)||(knownByName&&explicitCode&&normalizedCode(knownByName.product_code)!==explicitCode));
      if(hasConflict)conflicts++;
      if(!codeNames.has(code))codeNames.set(code,name);
      const key=`${normalizedName(zoneName)}\u0000${code}`,prior=seen.get(key);
      if(prior){
        duplicates++;
        if(normalizedName(prior.productName)!==nameKey||normalizedName(prior.unit)!==normalizedName(unit))conflicts++;
        continue;
      }
      const isMatched=Boolean(knownByCode||(!explicitCode&&knownByName));
      if(isMatched)matched++;else unmatched++;
      if(!name||!code||!unit||!zoneName)invalid++;
      const row={sheet:source.sheetName,sourceRow:index+1,sourceValues:cells,quantityColumn,zoneName,productCode:code,productName:name,unit,purchaseUnit,
        supplier:cellText(cells[header.map.supplier]),category:cellText(cells[header.map.category]),specification:cellText(cells[header.map.specification]),codeInferred:!explicitCode,zoneInferred:!explicitZone,unitInferred:unitResult.inferred,hasConflict};
      rows.push(row);seen.set(key,row);
    }
  }
  if(!rows.length){if(skippedSheets===sources.length)throw new Error('COUNT_IMPORT_HEADERS_REQUIRED');throw new Error('COUNT_IMPORT_ROWS_REQUIRED')}
  return{file,fileName:file.name,mimeType:file.type||(/\.csv$/i.test(file.name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),sheetName:usedSheets.join('、'),sheetNames:usedSheets,templateVersion:'PF-COUNT-IMPORT-V2',headers,rows,counts:{matched,unmatched,duplicates,missingUnit,invalid,conflicts,inferredCodes,inferredZones,skippedSheets},canPublish:invalid===0&&conflicts===0};
}

export async function downloadCountWorkbook(rows,sessionId){
  if(!window.ExcelJS)throw new Error('EXCEL_LIBRARY_UNAVAILABLE');
  const workbook=new window.ExcelJS.Workbook(),groups=new Map;
  for(const row of rows){const key=row.來源工作表||'盤點表';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  for(const[sheetName,items]of groups){const sheet=workbook.addWorksheet(String(sheetName).slice(0,31));for(const item of items){const source=Array.isArray(item.來源原列)?item.來源原列:[];source.forEach((value,index)=>{sheet.getCell(Number(item.來源列號),index+1).value=value});sheet.getCell(Number(item.來源列號),Number(item.數量欄位)).value=Number(item.數量)}}
  const buffer=await workbook.xlsx.writeBuffer(),link=document.createElement('a');link.href=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));link.download=`PantryFlow_盤點原位置回填_${sessionId}.xlsx`;link.click();URL.revokeObjectURL(link.href);
}
