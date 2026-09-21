"use client";

import { useState, type ReactNode, type Ref } from "react";
import { Check, ChevronUp, FileText, Plus } from "lucide-react";

type Props = {
  name: string; unit: string; supplier?: string; specification?: string | null;
  quantity: string; note: string; unclassified: boolean; disabled?: boolean;
  saveState: "empty" | "pending" | "saved" | "error" | "invalid";
  editor?: ReactNode; inputRef?: Ref<HTMLInputElement>;
  onQuantity: (value: string) => void; onNote: (value: string) => void; onAssign: () => void;
};

export default function CountEntryCard({ name, unit, supplier, specification, quantity, note, unclassified, disabled = false, saveState, editor, inputRef, onQuantity, onNote, onAssign }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  return <article className="shell-card count-item-card">
    <header className="count-item-heading">
      <details className="count-item-more"><summary><strong>{name}</strong></summary><small>{supplier || "廠商未提供"}{specification ? `｜${specification}` : ""}</small></details>
      {editor}
    </header>
    <label className="count-item-quantity"><span>盤點數量</span><input ref={inputRef} aria-label={`${name}數量`} aria-invalid={saveState==="invalid"||undefined} className="count-number" type="number" inputMode="decimal" min="0" step="any" placeholder="輸入數量" value={quantity} disabled={disabled} onChange={event => onQuantity(event.target.value)} /><span>{unit}</span></label>
    <div className="count-item-actions">
      {unclassified && <button type="button" className="count-item-action" disabled={disabled} onClick={onAssign}><Plus size={18} />儲物區</button>}
      <button type="button" className="count-item-action" disabled={disabled} aria-expanded={noteOpen} aria-label={`${name}備註`} onClick={() => setNoteOpen(value => !value)}>{note ? <FileText size={17} /> : <Plus size={18} />}備註{noteOpen && <ChevronUp size={16} />}</button>
    </div>
    {noteOpen ? <div className="count-item-note"><label><span>備註（選填）</span><textarea aria-label={`${name}備註內容`} value={note} rows={2} maxLength={2000} disabled={disabled} placeholder="例如：本期用完，下期可移除。" onChange={event => onNote(event.target.value)} /></label><button type="button" className="text-button" onClick={() => setNoteOpen(false)}>收起</button></div> : note && <p className="count-item-note-text">{note}</p>}
    {saveState !== "empty" && <small className={`count-item-save is-${saveState}`} role="status">{saveState === "saved" && <Check size={16} />}{saveState === "saved" ? "已儲存" : saveState === "pending" ? "儲存中…" : saveState==="invalid" ? "請填 0 或正數，數量與備註尚未儲存" : "尚未儲存，輸入已保留"}</small>}
  </article>;
}
