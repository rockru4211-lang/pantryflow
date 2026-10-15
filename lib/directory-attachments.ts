export type AttachmentKind='document'|'supplier';
export type DirectoryAttachment={id:string;filename:string;mime:string;byte_size:number;storage_path:string;ready_at:string|null;removed_at:string|null;stored?:boolean};
export const attachmentTypes:Record<string,string>={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
export const attachmentAccept=Object.keys(attachmentTypes).map(ext=>'.'+ext).join(',');
export function attachmentMime(file:{name:string;size:number}){
 const mime=attachmentTypes[file.name.split('.').pop()?.toLowerCase()||''];
 if(!mime)throw Error('請使用 JPG、PNG、WebP、HEIC、PDF、Word、Excel、MP4、MOV 或 WebM。');
 if(file.size<1||file.size>50*1024*1024)throw Error('每個附件須為 50 MB 以下的非空白檔案。');
 if(file.name.length>240)throw Error('檔名過長，請縮短後再上傳。');
 return mime;
}
export async function attachmentHash(file:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
