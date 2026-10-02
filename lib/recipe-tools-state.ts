export function removeMovedRecipeDrafts(raw:string|null,movedIds:string[]):string|null{
 if(!raw)return null;
 const value=JSON.parse(raw),moved=new Set(movedIds);
 if(value.version!==2||!Array.isArray(value.drafts)||!Array.isArray(value.tabs)||!Array.isArray(value.imports))throw Error('無法確認裝置草稿格式。');
 // A transfer is permitted only after all edits have been saved; never discard a new edit.
 for(const draft of value.drafts)if(moved.has(draft.id)&&(draft.pending||draft.saved!==JSON.stringify(draft.document)))throw Error('本機還有未同步的修改，已保留草稿。');
 value.drafts=value.drafts.filter((draft:{id:string})=>!moved.has(draft.id));
 value.tabs=value.tabs.filter((id:string)=>!moved.has(id));
 if(moved.has(value.active))value.active='';
 value.imports=value.imports.map((item:{recipeIds:string[]})=>({...item,recipeIds:item.recipeIds.filter(id=>!moved.has(id))})).filter((item:{recipeIds:string[];state:string})=>item.state!=='ready'||item.recipeIds.length>0);
 return JSON.stringify(value);
}
