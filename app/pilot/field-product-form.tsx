'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft} from 'lucide-react';
import {matchReceiptSuppliers} from '@/lib/receipt-supplier-items';
import UnitSelect from './unit-select';
import {fieldOptions,saveFieldProduct,fieldProductError,type FieldOptions,type FieldProduct} from '@/lib/field-product';
import './field-product-form.css';
type Props={storeId:string;targetStoreId?:string;initialName?:string;zoneId?:string;sessionId?:string;onClose:()=>void;onSaved:(product:FieldProduct)=>void|Promise<void>;beforeSave?:()=>Promise<boolean>;saveLabel?:string};
export default function FieldProductForm({storeId,targetStoreId=storeId,initialName='',zoneId,sessionId,onClose,onSaved,beforeSave,saveLabel='儲存'}:Props){
 const [name,setName]=useState(initialName),[unit,setUnit]=useState(''),[supplier,setSupplier]=useState(''),[price,setPrice]=useState('');
 const [options,setOptions]=useState<FieldOptions>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[hasSaved,setHasSaved]=useState(false),[loadError,setLoadError]=useState(false),[version,setVersion]=useState(0);
 const [existing,setExisting]=useState<FieldProduct>();const [supplierQuery,setSupplierQuery]=useState('');const[supplierOpen,setSupplierOpen]=useState(false);
 const lock=useRef(false),request=useRef<{signature:string;id:string}|undefined>(undefined),saved=useRef<FieldProduct|undefined>(undefined);const dialog=useRef<HTMLElement>(null);const title=useId();
 useEffect(()=>{let alive=true;fieldOptions(storeId,targetStoreId).then(data=>{if(alive){setOptions(data);setLoadError(false);}},()=>{if(alive)setLoadError(true);});return()=>{alive=false;};},[storeId,targetStoreId,version]);
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLInputElement>('input')?.focus();return()=>prior?.focus();},[]);
 const matches=options?.products.filter(p=>name.trim()&&p.name.normalize('NFKC').toLocaleLowerCase().includes(name.trim().normalize('NFKC').toLocaleLowerCase())).slice(0,6)||[];
 async function submit(){
  if(lock.current||!options||!name.trim()||!unit.trim())return;
  lock.current=true;setBusy(true);setError('');
  try{
   if(!saved.current){
    if(beforeSave&&!await beforeSave()){setError('原作業尚未儲存完成，請稍後重試。');return;}
    const data={name:name.trim(),unit:unit.trim(),supplier_id:existing?null:supplier||null,unit_price:existing||price===''?null:Number(price),product_id:existing?.id||null,zone_id:zoneId||null,session_id:sessionId||null};
    const signature=JSON.stringify(data);if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    saved.current=await saveFieldProduct(storeId,targetStoreId,data,request.current.id);setHasSaved(true);
   }
   await onSaved(saved.current);
  }catch(e){setError(saved.current?'品項已儲存，但尚未帶回原作業，請再按一次儲存。':fieldProductError(e));}
  finally{lock.current=false;setBusy(false);}
 }
 const frozen=busy||hasSaved;
 return createPortal(<div className="field-product-backdrop"><section ref={dialog} className="field-product-dialog" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={e=>{
  if(e.key==='Escape'&&!busy){e.stopPropagation();onClose();}
  if(e.key==='Tab'){const nodes=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)'));const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 }}><header><button type="button" aria-label="返回原作業" disabled={busy} onClick={onClose}><ArrowLeft size={23}/></button><h2 id={title}>新增品項</h2></header>
 <div className="field-product-store"><span>門市</span><strong>{options?.store_name||'讀取中…'}</strong></div>
 <form onSubmit={e=>{e.preventDefault();e.stopPropagation();void submit();}}>
 <label>品名 <small>必填</small><input required maxLength={160} value={name} disabled={frozen} placeholder="輸入品項名稱" onChange={e=>{setName(e.target.value);setExisting(undefined);}}/></label>
 {!existing&&matches.length>0&&<div className="field-product-matches"><small>已有品項可直接選用</small>{matches.map(p=><button type="button" key={p.id} disabled={frozen} onClick={()=>{setExisting(p);setName(p.name);setUnit(p.unit);setPrice('');setSupplier('');}}><span>{p.name}</span><small>{p.unit}</small></button>)}</div>}
 {existing&&<small role="status">已選用既有品項，不會重複建立。<button type="button" className="text-button" disabled={frozen} onClick={()=>setExisting(undefined)}>重新輸入</button></small>}
 <label>單位 <small>必填</small><UnitSelect units={options?.units.length?options.units:['公斤','克','台斤','公升','毫升','顆','瓶','罐','包','盒','箱','個']} value={unit} disabled={frozen||!!existing} onChange={setUnit}/></label>
 {!existing&&<><div className="field-supplier"><label htmlFor={`${title}-supplier`}>供應商 <small>（選填）</small></label><input id={`${title}-supplier`} type="search" role="combobox" aria-label="搜尋供應商" aria-expanded={supplierOpen} aria-controls={`${title}-suppliers`} placeholder="搜尋或選擇供應商" value={supplierQuery} disabled={frozen} onFocus={()=>setSupplierOpen(true)} onChange={e=>{setSupplierQuery(e.target.value);setSupplier('');setSupplierOpen(true);}}/>{supplierOpen&&<div className="field-product-matches" id={`${title}-suppliers`} role="listbox" aria-label="供應商選項"><button type="button" role="option" aria-selected={!supplier} onClick={()=>{setSupplier('');setSupplierQuery('');setSupplierOpen(false);}}>暫不填寫</button>{matchReceiptSuppliers(options?.suppliers||[],supplierQuery).map(s=><button type="button" role="option" aria-selected={s.id===supplier} key={s.id} onClick={()=>{setSupplier(s.id);setSupplierQuery(s.name);setSupplierOpen(false);}}>{s.name}</button>)}</div>}</div>
 <label>進價 <small>（選填）</small><span className="field-product-price"><input aria-label="進價" type="number" inputMode="decimal" min="0" max="999999999" step="any" value={price} disabled={frozen} placeholder="可後補" onChange={e=>setPrice(e.target.value)}/><span>元／{unit||'單位'}</span></span></label><p className="field-product-help">供應商、進價可之後補填</p></>}
 {loadError&&<p role="alert">選單暫時無法讀取。<button type="button" onClick={()=>setVersion(v=>v+1)}>重試</button></p>}
 {error&&<p role="alert">{error}</p>}
 <button type="submit" className="shell-primary full" disabled={busy||!options||!name.trim()||!unit.trim()}>{busy?'儲存中…':saveLabel}</button><p className="field-product-help">新增品項不會增加庫存</p>
 </form></section></div>,document.body);
}
