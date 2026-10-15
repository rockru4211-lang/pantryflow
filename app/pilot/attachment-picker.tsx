'use client';
import {useRef} from 'react';
import {attachmentAccept} from '@/lib/directory-attachments';
export default function AttachmentPicker({disabled=false,onFiles}:{disabled?:boolean;onFiles:(files:File[])=>void}){
 const menu=useRef<HTMLDetailsElement>(null),picker=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),video=useRef<HTMLInputElement>(null);
 const choose=(ref:typeof picker)=>{ref.current?.click();if(menu.current)menu.current.open=false;};
 return <div className="attachment-picker"><details ref={menu}><summary aria-disabled={disabled} onClick={e=>{if(disabled)e.preventDefault();}}>📎 加入附件</summary><div className="attachment-picker-menu"><button type="button" disabled={disabled} onClick={()=>choose(camera)}>拍照</button><button type="button" disabled={disabled} onClick={()=>choose(video)}>錄影</button><button type="button" disabled={disabled} onClick={()=>choose(picker)}>選擇照片／影片／檔案</button><small>每個檔案上限 50 MB</small></div></details>{[{ref:picker,accept:attachmentAccept,capture:undefined,multiple:true},{ref:camera,accept:'image/*',capture:'environment' as const,multiple:false},{ref:video,accept:'video/mp4,video/quicktime,video/webm',capture:'environment' as const,multiple:false}].map((p,i)=><input key={i} {...p} hidden type="file" disabled={disabled} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)onFiles(files);}}/>)}</div>;
}
