"use client";

import { useState, useRef, type ReactNode, type Ref } from "react";
import { Check, ChevronUp, FileText, Plus } from "lucide-react";

type Props = {
  name: string; unit: string; supplier?: string; specification?: string | null;
  quantity: string; note: string; unclassified: boolean; disabled?: boolean;
  saveState: "empty" | "pending" | "saved" | "error" | "invalid";
  compact?: boolean; showOpening?: boolean; opening?: {quantity: number | null; unit: string}; editor?: ReactNode | ((openNote: () => void) => ReactNode); inputRef?: Ref<HTMLInputElement>;
  onRemove?: () => Promise<boolean>;
  onQuantity: (value: string) => void; onNote: (value: string) => void; onAssign: () => void;
};

export default function CountEntryCard({ name, unit, supplier, specification, quantity, note, unclassified, disabled = false, saveState, compact = false, showOpening = true, opening, editor, inputRef, onQuantity, onNote, onAssign, onRemove }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [revealed,setRevealed]=useState(false);
  const start=useRef<{x:number;y:number}|null>(null);
  const swipe=compact&&!!onRemove;
  return <div className={`count-swipe${swipe?' is-enabled':''}${revealed&&!disabled?' is-revealed':''}`} tabIndex={swipe&&!disabled?0:undefined} aria-label={swipe?`${name}，左滑或按左方向鍵顯示移除`:undefined}
    onKeyDown={e=>{if(e.target!==e.currentTarget||!swipe||disabled)return;if(e.key==='ArrowLeft'){e.preventDefault();setRevealed(true);}if(e.key==='ArrowRight'||e.key==='Escape')setRevealed(false);}}
    onTouchStart={e=>{start.current=null;if(!swipe||disabled||e.touches.length!==1||(e.target as HTMLElement).closest('input,textarea,select,button,a,[role=dialog]'))return;start.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}
    onTouchMove={e=>{if(start.current&&(e.touches.length!==1||Math.abs(e.touches[0].clientY-start.current.y)>24))start.current=null;}}
    onTouchCancel={()=>{start.current=null;}}
    onTouchEnd={e=>{const origin=start.current;start.current=null;if(!origin||disabled||!e.changedTouches[0])return;const dx=e.changedTouches[0].clientX-origin.x,dy=e.changedTouches[0].clientY-origin.y;if(Math.abs(dx)>=55&&Math.abs(dx)>Math.abs(dy)*2)setRevealed(dx<0);}}>
    {swipe&&<button type="button" className="count-swipe-remove" aria-label={`移除 ${name}`} tabIndex={revealed&&!disabled?0:-1} disabled={disabled} onClick={async()=>{if(!disabled&&await onRemove?.())setRevealed(false);}}>移除</button>}
    <article className={`shell-card count-item-card${compact ? " is-compact" : ""}`}>
    <header className="count-item-heading">
      <details className="count-item-more"><summary><strong>{name}</strong>{supplier&&<span className="count-item-supplier">{supplier}</span>}</summary><small>{supplier || "廠商未提供"}{specification ? `｜${specification}` : ""}</small></details>
      {compact && showOpening && <small className="count-item-opening">期初：{opening?.quantity == null ? "未提供" : `${opening.quantity} ${opening.unit}`}</small>}
      <div className="count-item-editor">{typeof editor === "function" ? editor(() => setNoteOpen(true)) : editor}</div>
    </header>
    <label className="count-item-quantity"><span>盤點數量</span><input ref={inputRef} aria-label={`${name}數量`} aria-invalid={saveState==="invalid"||undefined} className="count-number" type="number" inputMode="decimal" min="0" step="any" placeholder="輸入數量" value={quantity} disabled={disabled} onChange={event => onQuantity(event.target.value)} /><span>{unit}</span></label>
    <div className={`count-item-actions${compact ? " compact-actions" : ""}`}>
      {unclassified && <button type="button" className="count-item-action" disabled={disabled} onClick={onAssign}><Plus size={18} />儲物區</button>}
      {!compact && <button type="button" className="count-item-action" disabled={disabled} aria-expanded={noteOpen} aria-label={`${name}備註`} onClick={() => setNoteOpen(value => !value)}>{note ? <FileText size={17} /> : <Plus size={18} />}備註{noteOpen && <ChevronUp size={16} />}</button>}
    </div>
    {noteOpen ? <div className="count-item-note"><label><span>備註（選填）</span><textarea aria-label={`${name}備註內容`} value={note} rows={2} maxLength={2000} disabled={disabled} placeholder="例如：本期用完，下期可移除。" onChange={event => onNote(event.target.value)} /></label><button type="button" className="text-button" onClick={() => setNoteOpen(false)}>收起</button></div> : note && <p className="count-item-note-text">{note}</p>}
    {saveState !== "empty" && (!compact || saveState === "error" || saveState === "invalid") && <small className={`count-item-save is-${saveState}`} role="status">{saveState === "saved" && <Check size={16} />}{saveState === "saved" ? "已儲存" : saveState === "pending" ? "儲存中…" : saveState==="invalid" ? "請填 0 或正數，數量與備註尚未儲存" : "尚未儲存，輸入已保留"}</small>}
  </article></div>;
}
