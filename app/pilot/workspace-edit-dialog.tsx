'use client';

import {useEffect,useRef,type ReactNode} from 'react';
import './workspace-edit-dialog.css';

export default function WorkspaceEditDialog({title,busy=false,onClose,children,wide=false}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;
  if(!dialog)return;
  const trigger=document.activeElement;
  dialog.showModal();
  dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus({preventScroll:true});
  return()=>{
   dialog.close();
   if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});
  };
 },[]);
 return <dialog ref={ref} className={wide?'workspace-edit-dialog workspace-edit-dialog-wide':'workspace-edit-dialog'} aria-label={title} onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();if(!busy)onClose();}}>
  <header><h2>{title}</h2>{wide&&<button type="button" className="shell-secondary" disabled={busy} onClick={onClose}>關閉編輯視窗</button>}</header>
  {wide?<div className="workspace-edit-body">{children}</div>:children}
 </dialog>;
}
