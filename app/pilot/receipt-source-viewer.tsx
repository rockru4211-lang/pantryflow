"use client";

import {useState} from "react";
import ReceiptImage from "./receipt-image";

type Document = {id:string;name:string;path:string;mime_type:string;page_order:number};

export default function ReceiptSourceViewer({documents,imageUrls}:{documents:Document[];imageUrls:Record<string,string>}) {
  const [selected,setSelected]=useState(0);
  const [zoom,setZoom]=useState(1);
  const pages=[...documents].sort((a,b)=>a.page_order-b.page_order);
  const index=Math.min(selected,Math.max(0,pages.length-1));
  const page=pages[index];
  const url=page&&imageUrls[page.path];
  const pdf=page?.mime_type==="application/pdf";
  if(!page)return <p className="receipt-source-empty">這張貨單沒有可顯示的原始檔案。</p>;
  return <div className="receipt-source-viewer">
    <div className="receipt-source-tools">
      <label>原始檔案<select aria-label="選擇原始貨單" value={index} onChange={event=>{setSelected(Number(event.target.value));setZoom(1);}}>
        {pages.map((document,i)=><option key={document.id} value={i}>第 {i+1} / {pages.length} 張・{document.name}</option>)}
      </select></label>
      {url&&<a href={url} target="_blank" rel="noreferrer">另開原檔</a>}
    </div>
    {!pdf&&<div className="receipt-source-zoom" aria-label="原單縮放">
      <button type="button" disabled={zoom<=1} onClick={()=>setZoom(value=>Math.max(1,value-.25))} aria-label="縮小原單">−</button>
      <span>{Math.round(zoom*100)}%</span>
      <button type="button" disabled={zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+.25))} aria-label="放大原單">＋</button>
      <button type="button" disabled={zoom===1} onClick={()=>setZoom(1)}>符合寬度</button>
    </div>}
    <div className="receipt-source-canvas">
      {!url?<p role="status">原始檔案讀取中；若持續無法顯示，請重新整理。</p>:pdf?
        <iframe title={`原始貨單 ${page.name}`} src={url} className="receipt-source-pdf"/>:
        <div className="receipt-source-image" style={{width:`${zoom*100}%`}}><ReceiptImage src={url} mime={page.mime_type} alt={`原始貨單第 ${index+1} 張，${page.name}`} style={{width:"100%",height:"auto",maxHeight:"none",display:"block"}}/></div>}
    </div>
  </div>;
}
