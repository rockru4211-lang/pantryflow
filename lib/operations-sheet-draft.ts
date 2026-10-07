import type {SheetRow} from './operations-sheet';
export type SheetDraft = {version:1;token:string;updatedAt:string;rows:SheetRow[]};
export type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function sheetDraftKey(userId:string,scope:string,month:string){return `operations-sheet-draft:${JSON.stringify([userId,scope,month])}`;}
export function readSheetDraft(storage:DraftStorage,key:string):SheetDraft|null{
 const raw=storage.getItem(key);if(!raw)return null;
 const value=JSON.parse(raw) as SheetDraft;
 if(value?.version!==1||typeof value.token!=='string'||typeof value.updatedAt!=='string'||!Array.isArray(value.rows)||!value.rows.every(r=>r&&typeof r.id==='string'&&r.values&&typeof r.values==='object'&&Object.values(r.values).every(v=>typeof v==='string')))throw Error('DRAFT_INVALID');
 return value;
}
// Refuse to replace a known newer snapshot written by another tab.
export function writeSheetDraft(storage:DraftStorage,key:string,rows:SheetRow[],expectedToken:string|null):SheetDraft|null{
 const current=readSheetDraft(storage,key);
 if((current?.token||null)!==expectedToken)throw Error('DRAFT_CHANGED');
 if(!rows.length){if(current)storage.removeItem(key);return null;}
 const next:SheetDraft={version:1,token:crypto.randomUUID(),updatedAt:new Date().toISOString(),rows:rows.map(r=>({...r,values:Object.fromEntries(Object.entries(r.values).map(([key,value])=>[key,String(value??'')]))}))};
 storage.setItem(key,JSON.stringify(next));return next;
}
export function draftStorageMessage(error:unknown){return error instanceof Error&&error.message==='DRAFT_CHANGED'?'另一個分頁已更新草稿，本頁輸入尚未暫存，請先儲存再離開。':'此裝置無法暫存草稿，輸入仍在本頁，請先儲存再離開。';}
