'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import './recipe-row-menu.css';

// Native popover renders above the scrolling table and closes on Escape/outside click.
export default function RecipeRowMenu({label,children}:{label:string;children:ReactNode}){
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 function position(){const button=trigger.current,menu=panel.current;if(!button||!menu)return;const rect=button.getBoundingClientRect();const width=Math.min(220,window.innerWidth-24),height=menu.offsetHeight;menu.style.width=`${width}px`;menu.style.left=`${Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12))}px`;menu.style.top=`${Math.max(12,rect.bottom+height+8>window.innerHeight?rect.top-height-6:rect.bottom+6)}px`;}
 useEffect(()=>{if(!open)return;const close=()=>panel.current?.hidePopover();window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};},[open]);
 return <><button ref={trigger} type="button" className="recipe-secondary" aria-label={label} aria-expanded={open} onClick={()=>{if(!panel.current)return;if(open)panel.current.hidePopover();else{panel.current.showPopover();position();}}}>⋯</button><div ref={panel} popover="auto" className="rd-row-menu" aria-label={label} onToggle={e=>setOpen(e.newState==='open')} onClick={e=>{if((e.target as HTMLElement).closest('button:not(:disabled)'))panel.current?.hidePopover();}}>{children}</div></>;
}
