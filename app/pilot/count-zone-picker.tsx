"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const formId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    if (!modal) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      modal.style.setProperty("--count-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      modal.style.setProperty("--count-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    const content = modal.closest<HTMLElement>(".shell-content");
    const bodyOverflow = document.body.style.overflow;
    const contentOverflow = content?.style.overflow;
    updateViewport();
    modal.showModal();
    document.body.style.overflow = "hidden";
    if (content) content.style.overflow = "hidden";
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      modal.close();
      document.body.style.overflow = bodyOverflow;
      if (content) content.style.overflow = contentOverflow ?? "";
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (editing) nameInput.current?.focus({ preventScroll: true });
  }, [editing]);
  return <dialog ref={dialog} className="shell-card count-zone-picker" aria-labelledby="count-zone-picker-title" onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <header><h2 id="count-zone-picker-title">{editing === "new" ? "新增儲物區" : editing ? "修改區域名稱" : title||(productName ? "放入儲物區" : "儲物區域")}</h2><button className="text-button" type="button" aria-label="關閉儲物區" disabled={busy} onClick={onClose}><X size={21} /></button></header>
    <div className="count-zone-body">
    {productName && <p>{productName}</p>}
    {editing ? <form id={formId} className="compact-form" onSubmit={async event => { event.preventDefault();if(busy||selectionBlocked)return; const saved = editing === "new" ? await onCreate(name) : await onRename(editing, name); if (saved) { setEditing(null); setName(""); } }}><label>區域名稱<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy||selectionBlocked} placeholder="例如：吧台冰箱" /></label></form> : <div className="count-zone-options">{zones.map(zone => <div key={zone.id}>
      {onSelect ? <button type="button" disabled={busy || selectionBlocked || editing !== null} onClick={() => void onSelect(zone.id)}>{zone.name}<span>›</span></button> : <strong>{zone.name}</strong>}
      {canRename && <button type="button" className="text-button" aria-label={`修改${zone.name}名稱`} disabled={busy||selectionBlocked} onClick={() => { setEditing(zone); setName(zone.name); }}><Pencil size={17} /></button>}
    </div>)}</div>}
    </div>
    <footer className="count-zone-footer">
    {notice && <><p role="status" className="count-feedback">{notice}</p><button type="button" className="text-button" disabled={busy} onClick={()=>void onReload()}>重新讀取共同進度</button></>}
    {editing ? <div className="count-zone-form-actions"><button className="shell-secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button form={formId} type="submit" className="shell-primary" disabled={busy || selectionBlocked || !name.trim()}>{busy ? "儲存中…" : editing === "new" ? "新增區域" : "儲存名稱"}</button></div> : <button className="text-button count-zone-add" type="button" disabled={busy||selectionBlocked} onClick={() => { setEditing("new"); setName(""); }}><Plus size={18} />新增區域</button>}
    </footer>
  </dialog>;
}
