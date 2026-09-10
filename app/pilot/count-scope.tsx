"use client";
import { useState } from 'react';
import type { Zone } from './count-workspace';
import type { CountItem } from '@/lib/count-flow';
export default function CountScope({zones,previous,onStart}:{zones:Zone[];previous:CountItem[];onStart:(items:{zone_id:string;product_id:string}[])=>Promise<void>}) {
 const [zoneId,setZoneId]=useState(zones[0]?.id || '');
 const all=zones.flatMap(z=>z.zone_products.map(p=>({zone_id:z.id,product_id:p.product_id})));
 const key=(r:{zone_id:string;product_id:string})=>`${r.zone_id}:${r.product_id}`;
 const [selected,setSelected]=useState(all.map(key)); const [query,setQuery]=useState(''); const [busy,setBusy]=useState(false);
 const zone=zones.find(z=>z.id===zoneId);
 return <><div className="shell-button-stack"><button className="shell-secondary" onClick={()=>setSelected(all.map(key))}>全品項</button>{previous.length>0&&<button className="shell-secondary" onClick={()=>setSelected(all.filter(r=>previous.some(p=>key(p)===key(r))).map(key))}>沿用上次選擇</button>}</div>
 <div className="scope-zone-grid">{zones.map(z=><button className={`scope-zone ${zoneId===z.id?'active':''}`} key={z.id} onClick={()=>setZoneId(z.id)}><strong>{z.name}</strong><small>已選 {z.zone_products.filter(p=>selected.includes(key({zone_id:z.id,product_id:p.product_id}))).length}／{z.zone_products.length} 項</small></button>)}</div>
 {zone&&<><div className="shell-section-head"><h2>{zone.name}</h2><button className="text-button" onClick={()=>setSelected(s=>[...new Set([...s,...zone.zone_products.map(p=>key({zone_id:zone.id,product_id:p.product_id}))])])}>全選此區</button></div><label className="zone-editor-field">搜尋品項<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 <div className="shell-card zone-candidates scope-items">{zone.zone_products.map(row=>{const p=Array.isArray(row.products)?row.products[0]:row.products;const id=key({zone_id:zone.id,product_id:row.product_id});return p?.name.includes(query)&&<label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={e=>setSelected(s=>e.target.checked?[...s,id]:s.filter(k=>k!==id))}/><span><strong>{p.name}</strong><small>{row.count_unit}</small></span></label>;})}</div></>}
 <p>已選 {selected.length}／{all.length} 項</p><button className="shell-primary full" disabled={busy||!selected.length} onClick={async()=>{setBusy(true);await onStart(all.filter(r=>selected.includes(key(r))));setBusy(false);}}>建立本次盤點</button></>;
}
