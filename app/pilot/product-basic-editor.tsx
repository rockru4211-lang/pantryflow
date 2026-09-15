'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {useOperation} from './operation-hooks';
export type BasicProduct={id:string;name:string;count_unit:string;specification:string|null;updated_at?:string};
export default function ProductBasicEditor({storeId,userId,product,onSaved}:{storeId:string;userId:string;product:BasicProduct;onSaved:(product:BasicProduct)=>void}){
 const[editing,setEditing]=useState(false);const[draft,setDraft]=useState(product);const[notice,setNotice]=useState('');const operation=useOperation(storeId,userId);const element=useRef<HTMLDivElement>(null);const position=useRef<number|null>(null);
 useLayoutEffect(()=>{if(!editing&&position.current!==null){element.current?.closest('.shell-content')?.scrollTo({top:position.current});position.current=null;}},[editing]);
 const close=()=>{position.current=element.current?.closest('.shell-content')?.scrollTop??null;setEditing(false);};
 return <div ref={element} className="product-inline-editor"><button type="button" className="text-button" aria-label={`編輯 ${product.name}`} onClick={()=>{setDraft(product);operation.setError('');setNotice('');setEditing(true);}}>編輯</button>{notice&&<small role="status">{notice}</small>}{editing&&<form className="product-basic-form" onSubmit={async e=>{e.preventDefault();const result=await operation.run<BasicProduct>('product.edit-basic',{id:product.id,name:draft.name,unit:draft.count_unit,specification:draft.specification,updated_at:draft.updated_at});if(result){onSaved(result);setNotice('基本資料已儲存。');close();}}}>
 <label>品名<input value={draft.name} maxLength={160} onChange={e=>setDraft({...draft,name:e.target.value})} required/></label><label>單位<input value={draft.count_unit} maxLength={30} onChange={e=>setDraft({...draft,count_unit:e.target.value})} required/></label><label>規格（選填）<input value={draft.specification||''} onChange={e=>setDraft({...draft,specification:e.target.value})}/></label><small>僅修改基本資料；盤點數量與排序分開保存。已開始的盤點沿用當次單位。</small>
 {operation.error&&<p role="alert">{operation.error}</p>}<div className="shell-button-stack"><button type="button" className="shell-secondary" disabled={operation.busy} onClick={close}>取消</button><button className="shell-primary" disabled={operation.busy}>{operation.busy?'儲存中…':'儲存'}</button></div></form>}</div>;
}
