"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import { blankCountPaperHtml, openBlankCountPaper, type BlankCountPaperZone } from "@/lib/count-blank-paper";
import "./count-blank-paper.css";

export default function CountBlankPaper({ storeName, zones, disabled=false }: {storeName:string;zones:BlankCountPaperZone[];disabled?:boolean}) {
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [notice,setNotice]=useState("");
  const trigger=useRef<HTMLButtonElement>(null), dialog=useRef<HTMLElement>(null);
  useEffect(()=>{if(open)dialog.current?.querySelector<HTMLInputElement>('input')?.focus();},[open]);
  function close(){setOpen(false);trigger.current?.focus();}
  const chosen=zones.filter(zone=>selected.includes(zone.id));
  const allSelected=zones.length>0&&chosen.length===zones.length;
  return <div className="count-blank-paper-control">
    <button ref={trigger} type="button" className="text-button count-blank-paper-trigger" disabled={disabled||!zones.length} onClick={()=>{setSelected(zones.map(zone=>zone.id));setNotice("");setOpen(true);}}><Printer size={16}/>列印盤點表</button>
    {notice&&!open&&<p className="count-feedback" role="status">{notice}</p>}
    {open&&<div className="modal-backdrop"><section ref={dialog} className="shell-card count-blank-paper-dialog" role="dialog" aria-modal="true" aria-labelledby="blank-paper-title" onKeyDown={event=>{
      if(event.key==="Escape")close();
      if(event.key==="Tab"){
        const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')),first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
      <header><h2 id="blank-paper-title">列印盤點表</h2><button type="button" className="text-button" aria-label="關閉列印設定" onClick={close}><X size={20}/></button></header>
      <p>選擇要列印的儲物區</p>
      <label className="count-paper-option all-areas"><input type="checkbox" checked={allSelected} onChange={event=>setSelected(event.target.checked?zones.map(zone=>zone.id):[])}/>全部區域</label>
      <div className="count-paper-zone-options">{zones.map(zone=><label className="count-paper-option" key={zone.id}><input type="checkbox" checked={selected.includes(zone.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,zone.id]:current.filter(id=>id!==zone.id))}/><span>{zone.name}</span><small>{zone.items.length} 項</small></label>)}</div>
      <p className="shell-note">A4 黑白列印，各區分頁；數量與備註留白。</p>
      {notice&&<p className="count-feedback" role="status">{notice}</p>}
      <div className="shell-button-stack"><button type="button" className="shell-secondary" onClick={close}>取消</button><button type="button" className="shell-primary" disabled={disabled||!chosen.length} onClick={()=>{setNotice("");if(openBlankCountPaper(blankCountPaperHtml(storeName,chosen),setNotice))close();}}>列印（{chosen.length} 區）</button></div>
    </section></div>}
  </div>;
}
