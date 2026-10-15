'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import './completion-dialog.css';
export default function CompletionDialog({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog ref={dialog} className="completion-dialog" aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><header><h2>{title}</h2><button type="button" disabled={busy} aria-label="關閉確認視窗" onClick={onClose}>×</button></header>{children}</dialog>;
}
