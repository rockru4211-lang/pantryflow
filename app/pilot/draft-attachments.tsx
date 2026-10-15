'use client';
import {useState} from 'react';
import {attachmentMime} from '@/lib/directory-attachments';
import AttachmentPicker from './attachment-picker';
export default function DraftAttachments({files,onChange,disabled=false}:{files:File[];onChange:(files:File[])=>void;disabled?:boolean}){
 const [error,setError]=useState('');
 const choose=(list:File[])=>{const valid:File[]=[];const errors:string[]=[];for(const file of Array.from(list||[])){try{attachmentMime(file);valid.push(file);}catch(e){errors.push(`${file.name}：${(e as Error).message}`);}}onChange([...files,...valid]);setError(errors.join('\n'));};
 return <div className="directory-attachments draft-attachments"><AttachmentPicker disabled={disabled} onFiles={choose}/>{error&&<p role="alert">{error}</p>}{files.map((f,i)=><div className="draft-attachment-file" key={`${i}:${f.name}`}><span>{f.name} · {(f.size/1024/1024).toFixed(1)} MB</span><button type="button" disabled={disabled} onClick={()=>onChange(files.filter((_,n)=>n!==i))}>移除</button></div>)}</div>;
}
