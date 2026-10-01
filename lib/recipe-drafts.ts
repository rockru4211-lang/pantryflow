import {linkRecipePreps, parseRecipeText, recipeCost, recipeUnit, type RecipeCard, type RecipeDocument, type RecipeWorkspace} from './recipe-cost';

export type RecipeWrite={id:string;revision:number;document:RecipeDocument;encoded:string;request:string};
export type RecipeDraft={id:string;revision:number;document:RecipeDocument;saved:string;pending?:RecipeWrite;error?:string};
export type RecipeImport={id:string;name:string;state:'reading'|'ready'|'error';recipeIds:string[];error?:string};
type Snapshot={version:2;drafts:RecipeDraft[];tabs:string[];active:string;imports:RecipeImport[]};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type Write=(pending:RecipeWrite)=>Promise<{revision:number}>;

// Each recipe owns its revision, retry token and in-flight write, even after tab switches.
export class RecipeDraftBook {
 drafts=new Map<string,RecipeDraft>();
 tabs:string[]=[];
 active='';
 imports:RecipeImport[]=[];
 storageError='';
 private flights=new Map<string,Promise<boolean>>();
 constructor(readonly key:string,private storage:Storage,private write:Write,private notify:()=>void,private describe:(e:unknown)=>string){
  try{
   const raw=storage.getItem(key);
   if(!raw)return;
   const value=JSON.parse(raw) as Snapshot;
   if(value.version!==2||!Array.isArray(value.drafts)||!Array.isArray(value.tabs)||!Array.isArray(value.imports))throw Error('draft');
   for(const draft of value.drafts){if(!draft.id||!draft.document||!Array.isArray(draft.document.lines))throw Error('draft');this.drafts.set(draft.id,draft);}
   this.tabs=value.tabs.filter(id=>this.drafts.has(id));this.active=this.tabs.includes(value.active)?value.active:'';
   this.imports=value.imports.map(item=>item.state==='reading'?{...item,state:'error',error:'讀取中斷，請重新選取這份檔案。'}:item);
  }catch{this.storageError='無法讀取上次草稿，請先保留此頁並重新確認。';}
 }
 persist(){
  try{this.storage.setItem(this.key,JSON.stringify({version:2,drafts:[...this.drafts.values()],tabs:this.tabs,active:this.active,imports:this.imports} satisfies Snapshot));this.storageError='';}
  catch{this.storageError='裝置空間不足，草稿尚未保留；請確認儲存成功後再離開。';}
  this.notify();
 }
 add(document:RecipeDocument,card?:Pick<RecipeCard,'id'|'revision'>,tab=true){
  const id=card?.id||crypto.randomUUID();
  if(!this.drafts.has(id))this.drafts.set(id,{id,revision:card?.revision||0,document,saved:card?JSON.stringify(document):''});
  if(tab){if(!this.tabs.includes(id))this.tabs.push(id);this.active=id;}
  this.persist();return id;
 }
 edit(id:string,document:RecipeDocument){const draft=this.drafts.get(id);if(draft){this.drafts.set(id,{...draft,document});this.persist();}}
 select(id:string){if(id&&!this.drafts.has(id))return;if(id&&!this.tabs.includes(id))this.tabs.push(id);this.active=id;this.persist();}
 dirty(id:string){const d=this.drafts.get(id);return !!d&&(!!d.pending||d.saved!==JSON.stringify(d.document));}
 busy(id:string){return this.flights.has(id);}
 async save(id:string):Promise<boolean>{
  const running=this.flights.get(id);if(running)return running;
  const draft=this.drafts.get(id);if(!draft||!this.dirty(id))return true;
  if(!draft.document.name.trim()){this.drafts.set(id,{...draft,error:'請先填配方名稱'});this.persist();return false;}
  const job=this.flush(id);this.flights.set(id,job);this.notify();
  try{return await job;}finally{this.flights.delete(id);this.notify();}
 }
 private async flush(id:string){
  // Finish a previously unconfirmed request before submitting later edits.
  for(let pass=0;pass<2;pass++){
   const draft=this.drafts.get(id);if(!draft||!this.dirty(id))return true;
   const pending=draft.pending||{id,revision:draft.revision,document:draft.document,encoded:JSON.stringify(draft.document),request:crypto.randomUUID()};
   this.drafts.set(id,{...draft,pending,error:undefined});this.persist();
   try{
    const result=await this.write(pending),latest=this.drafts.get(id)!;
    this.drafts.set(id,{...latest,revision:result.revision,saved:pending.encoded,pending:undefined,error:undefined});this.persist();
   }catch(e){const latest=this.drafts.get(id)!;this.drafts.set(id,{...latest,error:this.describe(e)});this.persist();return false;}
  }
  return !this.dirty(id);
 }
 async saveAll(){
  const visited=new Set<string>(),order:string[]=[];
  const visit=(id:string)=>{if(visited.has(id))return;visited.add(id);const draft=this.drafts.get(id);if(!draft)return;for(const line of draft.document.lines)if(line.recipe_id)visit(line.recipe_id);order.push(id);};
  for(const id of this.drafts.keys())visit(id);
  let ok=true;for(const id of order)if(this.dirty(id)&&!await this.save(id))ok=false;return ok;
 }
 close(id:string){this.tabs=this.tabs.filter(tab=>tab!==id);if(this.active===id)this.active=this.tabs.at(-1)||'';this.persist();}
 refresh(workspace:RecipeWorkspace){
  for(const card of workspace.recipes){const draft=this.drafts.get(card.id);if(draft&&!this.dirty(card.id)&&!this.busy(card.id)&&card.revision>draft.revision)this.drafts.set(card.id,{...draft,revision:card.revision,document:card.document,saved:JSON.stringify(card.document)});}
  this.persist();
 }
 overlay(workspace:RecipeWorkspace):RecipeWorkspace{
  const cards=new Map(workspace.recipes.map(card=>[card.id,card]));
  for(const draft of this.drafts.values()){
   const live=cards.get(draft.id);
   if(!live||this.dirty(draft.id)||draft.revision>=live.revision)cards.set(draft.id,{id:draft.id,revision:draft.revision,document:draft.document,updated_at:live?.updated_at||'',cost:{total:null,subtotal:0,missing:0,lines:[]}});
  }
  const combined={...workspace,recipes:[...cards.values()]};
  return {...combined,recipes:combined.recipes.map(card=>({...card,cost:recipeCost(card.document,combined,[card.id])}))};
 }
 removeImport(id:string){this.imports=this.imports.filter(item=>item.id!==id);this.persist();}
}

export async function recipeFileId(file:File){
 if(file.size>10*1024*1024)throw Error('請上傳 10MB 以下的食譜。');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return `${file.name}:${Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}`;
}

export function importedRecipeCards(text:string,name:string,workspace:RecipeWorkspace):RecipeCard[]{
 if(!text.trim())throw Error('檔案沒有可讀取的食譜文字。');
 const group=crypto.randomUUID();
 const cards=parseRecipeText(text,name.replace(/\.[^.]+$/,'')).map(document=>({id:crypto.randomUUID(),revision:0,updated_at:'',document:{...document,source_import_id:group},cost:{total:null,subtotal:0,missing:0,lines:[]}} as RecipeCard));
 // Link only unique sections of this file. Equal names in another file stay separate.
 const local={...workspace,recipes:cards,prices:[]};
 for(const card of cards){
  card.document=linkRecipePreps(card.document,local,[card.id]);
  card.document={...card.document,lines:card.document.lines.map(line=>{
   if(line.recipe_id)return line;
   // Reuse an already saved alias only within this new file's unique prep section.
   // Keep the chef's ingredient name and usage unchanged; never fuzzy-match products.
   const aliasNames=[...new Set(workspace.recipes.flatMap(r=>r.document.lines).filter(l=>l.name===line.name&&l.recipe_id).map(l=>workspace.recipes.find(r=>r.id===l.recipe_id)?.document.name).filter(Boolean))];
   const aliases=cards.filter(r=>r.id!==card.id&&r.document.kind==='prep'&&aliasNames.includes(r.document.name)&&recipeUnit(r.document.unit)===recipeUnit(line.unit));
   if(!line.product_id&&aliasNames.length===1&&aliases.length===1){
    const linked=linkRecipePreps({...card.document,lines:[{...line,name:aliases[0].document.name}]},local,[card.id]);
    if(linked.lines[0].recipe_id)return {...line,recipe_id:linked.lines[0].recipe_id};
   }
   const remembered=[...new Set(workspace.recipes.flatMap(r=>r.document.lines).filter(x=>x.name===line.name&&x.product_id).map(x=>x.product_id!))];
   const matches=workspace.products.filter(p=>p.name===line.name);
   const product_id=remembered.length===1?remembered[0]:matches.length===1?matches[0].id:undefined;
   return product_id?{...line,product_id}:line;
  })};
 }
 return cards;
}

function fileError(error:unknown){const message=error instanceof Error?error.message:'';return /[\u3400-\u9fff]/.test(message)?message:'無法讀取這份檔案，請確認檔案完整，或另存為 Word／PDF 後重試。';}

export async function importRecipeFiles(files:File[],book:RecipeDraftBook,workspace:RecipeWorkspace,read:(file:File)=>Promise<string>,remember:(id:string,file:File)=>void){
 let first='';
 for(const file of files){
  let fingerprint='';
  try{fingerprint=await recipeFileId(file);}catch(e){fingerprint=`invalid:${file.name}:${file.size}`;const entry={id:fingerprint,name:file.name,state:'error' as const,recipeIds:[],error:fileError(e)};book.imports=book.imports.filter(item=>item.id!==fingerprint).concat(entry);remember(fingerprint,file);book.persist();continue;}
  remember(fingerprint,file);
  const existing=book.imports.find(item=>item.id===fingerprint);
  if(existing?.state==='ready'){
   const roots=existing.recipeIds.filter(id=>book.drafts.get(id)?.document.kind==='dish');
   for(const id of roots.length?roots:existing.recipeIds){book.select(id);first||=id;}continue;
  }
  const entry:RecipeImport={id:fingerprint,name:file.name,state:'reading',recipeIds:[]};
  book.imports=book.imports.filter(item=>item.id!==fingerprint).concat(entry);book.persist();
  try{
   const cards=importedRecipeCards(await read(file),file.name,workspace);
   for(const card of cards)book.drafts.set(card.id,{id:card.id,revision:0,document:card.document,saved:''});
   entry.recipeIds=cards.map(card=>card.id);entry.state='ready';
   const roots=cards.filter(card=>card.document.kind==='dish');
   for(const card of roots.length?roots:cards){book.select(card.id);first||=card.id;}
   book.persist();
  }catch(e){entry.state='error';entry.error=fileError(e);book.persist();}
 }
 if(first)book.select(first);
}
