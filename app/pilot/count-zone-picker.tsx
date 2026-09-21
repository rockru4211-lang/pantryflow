"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";

export type CountPickerZone = { id: string; name: string; updated_at: string };

export default function CountZonePicker({ zones, productName, busy, notice, canRename, onSelect, onCreate, onRename, onClose, onReload, title, selectionBlocked=false }: {
  zones: CountPickerZone[]; productName?: string; busy: boolean; notice: string; canRename: boolean;
  onSelect?: (id: string) => Promise<void>; onCreate: (name: string) => Promise<boolean>;
  onRename: (zone: CountPickerZone, name: string) => Promise<boolean>; onClose: () => void;
  onReload: () => Promise<void>;
  title?:string;selectionBlocked?:boolean;
}) {
  const [editing, setEditing] = useState<CountPickerZone | "new" | null>(null);
  const [name, setName] = useState("");
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop count-zone-backdrop"><section ref={dialog} className="shell-card count-zone-picker" role="dialog" aria-modal="true" aria-labelledby="count-zone-picker-title" onKeyDown={event => {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key === "Tab") {
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><h2 id="count-zone-picker-title">{title||(productName ? "放入儲物區" : "儲物區域")}</h2><button className="text-button" type="button" aria-label="關閉儲物區" disabled={busy} onClick={onClose}><X size={21} /></button></header>
    {productName && <p>{productName}</p>}
    <div className="count-zone-options">{zones.map(zone => <div key={zone.id}>
      {onSelect ? <button type="button" disabled={busy || selectionBlocked || editing !== null} onClick={() => void onSelect(zone.id)}>{zone.name}<span>›</span></button> : <strong>{zone.name}</strong>}
      {canRename && <button type="button" className="text-button" aria-label={`修改${zone.name}名稱`} disabled={busy||selectionBlocked} onClick={() => { setEditing(zone); setName(zone.name); }}><Pencil size={17} /></button>}
    </div>)}</div>
    {editing ? <form className="compact-form" onSubmit={async event => { event.preventDefault();if(selectionBlocked)return; const saved = editing === "new" ? await onCreate(name) : await onRename(editing, name); if (saved) { setEditing(null); setName(""); } }}><label>區域名稱<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoFocus disabled={busy||selectionBlocked} placeholder="例如：吧台冰箱" /></label><div className="shell-button-stack"><button className="shell-secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="shell-primary" disabled={busy || selectionBlocked || !name.trim()}>{busy ? "儲存中…" : editing === "new" ? "新增區域" : "儲存名稱"}</button></div></form> : <button className="text-button count-zone-add" type="button" disabled={busy||selectionBlocked} onClick={() => { setEditing("new"); setName(""); }}><Plus size={18} />新增區域</button>}
    {notice && <><p role="status" className="count-feedback">{notice}</p><button type="button" className="text-button" disabled={busy} onClick={()=>void onReload()}>重新讀取共同進度</button></>}
  </section></div>;
}
