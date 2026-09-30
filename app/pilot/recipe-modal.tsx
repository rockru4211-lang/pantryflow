'use client';

import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';

// Native dialog keeps keyboard focus inside the editor and the underlying table inert.
export default function RecipeModal({title,busy=false,onClose,children,returnFocus}:{title:string;busy?:boolean;onClose:()=>void;children:ReactNode;returnFocus?:{current:HTMLElement|null}}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const modal=dialog.current!;
  const previous=returnFocus?.current||document.activeElement as HTMLElement|null;
  const scroller=modal.closest<HTMLElement>('.shell-content');
  const overflow=document.body.style.overflow,contentOverflow=scroller?.style.overflow;
  const scrollTop=scroller?.scrollTop||0,windowTop=window.scrollY;
  const viewport=window.visualViewport;
  const resize=()=>{modal.style.setProperty('--recipe-viewport-height',`${viewport?.height??window.innerHeight}px`);modal.style.setProperty('--recipe-viewport-top',`${viewport?.offsetTop??0}px`);};
  resize();modal.showModal();document.body.style.overflow='hidden';if(scroller)scroller.style.overflow='hidden';
  viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
  return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);modal.close();document.body.style.overflow=overflow;if(scroller){scroller.style.overflow=contentOverflow||'';scroller.scrollTop=scrollTop;}window.scrollTo({top:windowTop,behavior:'instant'});previous?.focus({preventScroll:true});};
 },[returnFocus]);
 return <dialog ref={dialog} className="recipe-modal" aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header className="recipe-modal-header"><h2>{title}</h2><button type="button" className="recipe-icon-button" aria-label="完成並關閉編輯視窗" disabled={busy} onClick={onClose}><X size={22}/></button></header>
  <div className="recipe-modal-content">{children}</div>
 </dialog>;
}
