'use client';

import {useEffect,useRef,type ReactNode} from 'react';
import './workspace-edit-dialog.css';

export default function WorkspaceEditDialog({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;
  if(!dialog)return;
  const trigger=document.activeElement;
  dialog.showModal();
  return()=>{
   dialog.close();
   if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});
  };
 },[]);
 return <dialog ref={ref} className="workspace-edit-dialog" aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header><h2>{title}</h2></header>
  {children}
 </dialog>;
}
