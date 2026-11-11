'use client';

import {useEffect,useRef,type ReactNode} from 'react';
import './workspace-edit-dialog.css';

export default function WorkspaceEditDialog({title,busy=false,onClose,children,wide=false,side=false}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode;wide?:boolean;side?:boolean}){
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
 useEffect(()=>{
  if(!side)return;
  const dialog=ref.current;
  const target=dialog?.querySelector<HTMLElement>('[data-initial-focus]')??dialog?.querySelector<HTMLElement>('.workspace-edit-side-close');
  target?.focus({preventScroll:true});
 },[side,title]);
 return <dialog ref={ref} className={`workspace-edit-dialog${wide?' workspace-edit-dialog-wide':''}${side?' workspace-edit-dialog-side':''}`} aria-label={title} onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();if(!busy)onClose();}}>
  <header><h2>{title}</h2>{(wide||side)&&<button type="button" className={side?'shell-secondary workspace-edit-side-close':'shell-secondary'} disabled={busy} onClick={onClose}>{side?'關閉':'關閉編輯視窗'}</button>}</header>
  {wide?<div className="workspace-edit-body">{children}</div>:children}
 </dialog>;
}
