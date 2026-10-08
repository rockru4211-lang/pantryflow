import {purchaseUnitPrice} from './cost-price.ts';
export type SheetKind='receipt'|'inventory'|'transfer'|'waste';
export type SheetValues=Record<string,string>;
export type SheetRow={id:string;values:SheetValues;state?:string;locked?:boolean;fresh?:boolean;requestId?:string;meta?:unknown};
export type SheetColumn={key:string;label:string;type?:'text'|'number'|'date';readonly?:boolean;options?:string[];select?:boolean;required?:boolean;editable?:(row:SheetRow)=>boolean};
export function sheetNumber(value:string){if(!value.trim())return null;const n=Number(value.replaceAll(',',''));if(!Number.isFinite(n)||n<0||n>=1e9)throw Error('數量與單價須為 0 至十億之間的有效數字。');return n;}
export function sheetFingerprint(values:SheetValues,columns:SheetColumn[]){return JSON.stringify(columns.filter(c=>!c.readonly).map(c=>[c.key,(values[c.key]||'').trim()]));}
export function sheetImports(records:Record<string,unknown>[],columns:SheetColumn[],existing:SheetRow[],defaults:SheetValues,newId:()=>string){
 const seen=new Set(existing.map(r=>sheetFingerprint(r.values,columns))),ids=new Set<string>();const rows:SheetRow[]=[];let skipped=0;
 for(const record of records){const identity=String(record['資料編號']||'').trim();const original=identity?existing.find(r=>r.id===identity):undefined;if(identity&&!original)throw Error('檔案包含目前月份或狀態以外的資料編號，請切換至原月份與狀態後再匯入。');if(original?.locked||original?.state==='REMOVED')throw Error('檔案包含已移除或封存資料，請先還原或移除該列。');
  const values={...defaults,...original?.values};for(const c of columns){if(c.readonly||original&&c.editable&&!c.editable(original))continue;if(record[c.label]!==undefined){let value=String(record[c.label]??'').trim();if(c.type==='number')value=value.replaceAll(',','');if(c.type==='date'&&/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)){const [y,m,d]=value.split(/[/-]/);value=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}values[c.key]=value;}}
  if(columns.some(c=>c.key==='amount')&&(!original||values.quantity!==original.values.quantity||values.price!==original.values.price))values.amount=moneyAmount(values.quantity||'',values.price||'');
  if(!Object.values(record).some(v=>String(v??'').trim()))continue;if('purchase_price' in values)Object.assign(values,recalculateSheet(values));const fingerprint=sheetFingerprint(values,columns);if(seen.has(fingerprint)||identity&&ids.has(identity)){skipped++;continue;}seen.add(fingerprint);if(identity)ids.add(identity);const id=original?.id||newId();rows.push({...original,id,values,fresh:!original,requestId:newId()});
 }return {rows,skipped};
}

// Merge only fields actually changed by this editor; reject competing edits to the same field.
export function sheetMerge(base:SheetValues,proposed:SheetValues,current:SheetValues,keys:string[]){
 const merged={...current};for(const key of keys){const before=base[key]||'',after=proposed[key]||'',now=current[key]||'';if(after===before)continue;if(now!==before&&now!==after)throw Error('REVISION_CONFLICT');merged[key]=after;}return merged;
}

export const costingUnits=['公斤','台斤','克','公升','ml','瓶','罐','包','盒','袋','箱','桶','支','顆','個','片','卷','份'];
export function moneyAmount(quantity:string,price:string){
 if(!quantity.trim()||!price.trim())return '';
 const n=Number(quantity)*Number(price);
 return Number.isFinite(n)&&n>=0?String(Math.round((n+Number.EPSILON)*100)/100):'';
}
/** A quotation has its own unit; transaction quantities never reinterpret that unit. */
export function recalculateSheet(values:SheetValues):SheetValues{
 if(!('purchase_price' in values))return {...values,amount:moneyAmount(values.quantity||'',values.price||'')};
 const amount=values.purchase_price.trim()===''?null:Number(values.purchase_price);
 const price=amount===null?null:purchaseUnitPrice({amount,quantity:1,unit:values.price_unit||'',...(values.content_quantity?{content_quantity:Number(values.content_quantity),content_unit:values.content_unit}: {})},values.unit||'');
 return {...values,price:price===null?'':String(price),amount:price===null?'':moneyAmount(values.quantity||'',String(price)),price_source:price===null&&amount!==null?'待補規格／核對單位':values.price_source};
}
export function changeSheetValues(values:SheetValues,key:string,value:string){
 let next={...values,[key]:value};
 if('purchase_price' in values&&['name','from'].includes(key)&&value!==values[key])next={...next,price:'',purchase_price:'',price_unit:'',content_quantity:'',content_unit:'',amount:'',price_source:'待帶入確認進價'};
 if(key==='unit'&&!('purchase_price' in values))next={...next,purchase_price:values.price||'',price_unit:values.unit||''};
 if(['quantity','unit','price','purchase_price','price_unit','content_quantity','content_unit','name','from'].includes(key))next=recalculateSheet(next);
 return next;
}
