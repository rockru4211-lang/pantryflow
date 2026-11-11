'use client';
import {receiptCustodyLabel,receiptHandling,receiptHandlingLabels,type ReviewDraft} from '@/lib/receipt-review';
import './receipt-handling.css';

type Props={
 line:ReviewDraft['lines'][number];
 index:number;
 editing:boolean;
 disabled:boolean;
 handlingLocked:boolean;
 onChange:(key:string,value:string)=>void;
};

export default function ReceiptHandlingFields({line,index,editing,disabled,handlingLocked,onChange}:Props){
 const handling=receiptHandling(line);
 if(!editing){
  const badge=receiptCustodyLabel(line);
  return badge?<small className="receipt-custody-badge">{badge}</small>
   :handling==='FREIGHT'?<small className="receipt-custody-badge">{receiptHandlingLabels.FREIGHT}</small>:null;
 }
 return <div className="receipt-handling">
  <label>處理方式
   <select aria-label={`第 ${index+1} 筆 處理方式`} value={handling} disabled={disabled||handlingLocked} onChange={event=>onChange('handling',event.target.value)}>
    {Object.entries(receiptHandlingLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
   </select>
  </label>
  {handling==='CUSTODY_RELEASE'&&<label>單上寄庫餘量
   <span className="receipt-custody-remaining-field">
    <input aria-label={`第 ${index+1} 筆 單上寄庫餘量`} inputMode="decimal" placeholder="選填" value={line.custody_remaining??''} disabled={disabled} onChange={event=>onChange('custody_remaining',event.target.value)}/>
    {line.unit&&<span>{line.unit}</span>}
   </span>
  </label>}
 </div>;
}
