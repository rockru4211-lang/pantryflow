import {administrativeSection,equipmentContact,type AdministrativeRow} from './administrative-directory.ts';
export function repairDirectory(rows:AdministrativeRow[],query:string){
 const key=query.trim().normalize('NFKC').toLocaleLowerCase();
 return rows.filter(r=>!r.archived&&!r.is_removed&&r.category!=='維修紀錄'&&administrativeSection(r.category)==='equipment').map(row=>({row,...equipmentContact(row.summary)})).filter(r=>[r.row.name,r.service,r.contact,r.phone,r.method].join(' ').normalize('NFKC').toLocaleLowerCase().includes(key));
}
export function repairLineLink(value:string){
 for(const candidate of value.match(/https?:\/\/[^\s<>「」]+/g)||[]){try{const u=new URL(candidate);if(u.protocol==='https:'&&(u.hostname==='line.me'||u.hostname.endsWith('.line.me')||u.hostname==='lin.ee'))return u.href;}catch{/* plain contact text */}}
 return null;
}
