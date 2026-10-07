export type SheetKind='receipt'|'inventory'|'transfer'|'waste';
export type SheetValues=Record<string,string>;
export type SheetRow={id:string;values:SheetValues;state?:string;locked?:boolean;fresh?:boolean;requestId?:string;meta?:unknown};
export type SheetColumn={key:string;label:string;type?:'text'|'number'|'date';readonly?:boolean;options?:string[];required?:boolean;editable?:(row:SheetRow)=>boolean};
export function sheetNumber(value:string){if(!value.trim())return null;const n=Number(value.replaceAll(',',''));if(!Number.isFinite(n)||n<0||n>=1e9)throw Error('數量與單價須為 0 至十億之間的有效數字。');return n;}
export function sheetFingerprint(values:SheetValues,columns:SheetColumn[]){return JSON.stringify(columns.filter(c=>!c.readonly).map(c=>[c.key,(values[c.key]||'').trim()]));}
export function sheetImports(records:Record<string,unknown>[],columns:SheetColumn[],existing:SheetRow[],defaults:SheetValues,newId:()=>string){
 const seen=new Set(existing.map(r=>sheetFingerprint(r.values,columns))),ids=new Set<string>();const rows:SheetRow[]=[];let skipped=0;
 for(const record of records){const identity=String(record['資料編號']||'').trim();const original=identity?existing.find(r=>r.id===identity):undefined;if(identity&&!original)throw Error('檔案包含目前月份或狀態以外的資料編號，請切換至原月份與狀態後再匯入。');if(original?.locked||original?.state==='REMOVED')throw Error('檔案包含已移除或封存資料，請先還原或移除該列。');
  const values={...defaults,...original?.values};for(const c of columns){if(c.readonly||original&&c.editable&&!c.editable(original))continue;if(record[c.label]!==undefined){let value=String(record[c.label]??'').trim();if(c.type==='number')value=value.replaceAll(',','');if(c.type==='date'&&/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)){const [y,m,d]=value.split(/[/-]/);value=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}values[c.key]=value;}}
  if(columns.some(c=>c.key==='amount')&&(!original||values.quantity!==original.values.quantity||values.price!==original.values.price))values.amount=values.quantity&&values.price&&Number.isFinite(Number(values.quantity)*Number(values.price))?String(Number(values.quantity)*Number(values.price)):'';
  if(!Object.values(record).some(v=>String(v??'').trim()))continue;const fingerprint=sheetFingerprint(values,columns);if(seen.has(fingerprint)||identity&&ids.has(identity)){skipped++;continue;}seen.add(fingerprint);if(identity)ids.add(identity);const id=original?.id||newId();rows.push({...original,id,values,fresh:!original,requestId:newId()});
 }return {rows,skipped};
}

// Merge only fields actually changed by this editor; reject competing edits to the same field.
export function sheetMerge(base:SheetValues,proposed:SheetValues,current:SheetValues,keys:string[]){
 const merged={...current};for(const key of keys){const before=base[key]||'',after=proposed[key]||'',now=current[key]||'';if(after===before)continue;if(now!==before&&now!==after)throw Error('REVISION_CONFLICT');merged[key]=after;}return merged;
}
