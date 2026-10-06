export type RecipeLine={id:string;name:string;quantity:string;unit:string;product_id?:string;ingredient_id?:string;recipe_id?:string;note?:string};
export type RecipeDocument={name:string;kind:'dish'|'prep';yield:string;unit:string;lines:RecipeLine[];notes:string;photo?:string;source_name?:string;source_import_id?:string;source_section_order?:string[];source_section_index?:number;source_section_name?:string;component_order?:string[];portion_quantity?:string;portion_unit?:string};
export type RecipePrice={key:string;name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string|null;reference_id?:string;source_id?:string;recorded_at?:string;source_kind?:'manual'|'purchase'|'history';source_ref?:{missing_price?:boolean;url?:string;name?:string;review_note?:string;supplier_name?:string;supplier_id?:string;specification?:string;product_id?:string};conversion_pending?:boolean;previous_price?:number|null;previous_date?:string|null;previous_purchase?:RecipePurchase|null;supplier_name?:string;cost_price?:number|null;purchase?:RecipePurchase|null};
export type RecipePriceReference=RecipePrice&{review_status:'confirmed'|'pending';created_at:string};
export type RecipeCost={total:number|null;subtotal:number;missing:number;lines:{id:string;amount:number|null;reason:string|null;price:RecipePrice|null}[]};
export type RecipeCostApproval={id:string;document:RecipeDocument;cost:RecipeCost;at:string;origin:string};
export type RecipeCard={cost_loaded?:boolean;proposed_cost_token?:string;cost_history?:{id:string;at:string;cost:RecipeCost;actor_name?:string}[];approved_cost?:RecipeCostApproval|null;proposed_cost?:RecipeCost;id:string;revision:number;document:RecipeDocument;updated_at:string;cost:RecipeCost};
export type RecipeWorkspace={pricing_loaded?:boolean;cost_mode?:'latest';ingredients?:import('./ingredient-catalog').IngredientMaster[];recipes:RecipeCard[];products:{id:string;name:string;unit:string;specification?:string}[];prices:RecipePrice[];price_candidates?:RecipePrice[];price_references?:RecipePriceReference[];suppliers?:{id:string;name:string}[];can_price:boolean};
// Imported serving headings use their source title for display; stored names stay intact.
export function recipeDisplayName(doc:RecipeDocument){
 return doc.kind==='dish'&&/^(出餐|成品|出餐菜色)$/.test(doc.name.trim())&&doc.source_name?.trim()?doc.source_name.trim():doc.name;
}
export function recipeUnit(unit:string){const u=unit.trim().toLowerCase();return ['g','kg','公克','克','公斤','斤','台斤','臺斤'].includes(u)?'g':['ml','l','毫升','公升'].includes(u)?'ml':['顆','個','pc','pcs'].includes(u)?'顆':u==='box'?'盒':u;}
export function recipeFactor(unit:string){const u=unit.trim().toLowerCase();return ['kg','公斤','l','公升'].includes(u)?1000:['斤','台斤','臺斤'].includes(u)?600:1;}
const recipeName=(name:string)=>name.normalize('NFKC').trim().toLowerCase();
export type RecipeComponent={id:string;name:string;recipe:RecipeCard|null;candidates:RecipeCard[];uses:{parent:RecipeCard;line:RecipeLine}[]};
// A recipe's components include nested preparations and sections of its source file.
// Membership never adds usage lines or changes costing. Actual references choose versions.
export function recipeComponents(root:RecipeCard,workspace:RecipeWorkspace):RecipeComponent[]{
 const cards=new Map(workspace.recipes.map(card=>[card.id,card]));
 const entries=new Map<string,RecipeComponent>(),ordered:RecipeComponent[]=[];
 const visited=new Set<string>([root.id]),listed=new Set<string>();
 const ensure=(id:string,name:string)=>{
  let entry=entries.get(id);
  if(!entry){const card=cards.get(id)||null;entry={id,name:card?.document.name||name,recipe:card,candidates:card?[card]:[],uses:[]};entries.set(id,entry);}
  return entry;
 };
 const append=(entry:RecipeComponent)=>{if(!listed.has(entry.id)){listed.add(entry.id);ordered.push(entry);}};
 const walk=(parent:RecipeCard,depth=0)=>{
  if(depth>=20)return;
  for(const line of parent.document.lines){
   if(!line.recipe_id||line.recipe_id===root.id)continue;
   const entry=ensure(line.recipe_id,line.name);
   if(!entry.uses.some(use=>use.parent.id===parent.id&&use.line.id===line.id))entry.uses.push({parent,line});
   if(entry.recipe&&!visited.has(entry.id)){visited.add(entry.id);walk(entry.recipe,depth+1);}
   append(entry);
  }
 };
 walk(root);
 const source=recipeName(root.document.source_name||'');
 const sameSource=(doc:RecipeDocument)=>root.document.source_import_id?doc.source_import_id===root.document.source_import_id:!doc.source_import_id&&recipeName(doc.source_name||'')===source;
 // Shared filenames with several main dishes cannot establish unreferenced ownership.
 if(source&&root.document.kind==='dish'&&workspace.recipes.filter(card=>card.document.kind==='dish'&&sameSource(card.document)).length===1){
  const groups=new Map<string,RecipeCard[]>();
  for(const card of workspace.recipes){
   if(card.document.kind!=='prep'||!sameSource(card.document))continue;
   const key=recipeName(card.document.name);groups.set(key,[...(groups.get(key)||[]),card]);
  }
  // Traverse unique sections first; their references may resolve a duplicated section.
  for(const candidates of groups.values())if(candidates.length===1){
   const card=candidates[0],entry=ensure(card.id,card.document.name);
   if(!visited.has(card.id)){visited.add(card.id);walk(card);}
   append(entry);
  }
  for(const [name,candidates]of groups){
   if(candidates.some(card=>entries.has(card.id)))continue;
   const entry:RecipeComponent={id:`source:${source}:${name}`,name:candidates[0].document.name,recipe:null,candidates,uses:[]};
   entries.set(entry.id,entry);append(entry);
  }
 }
 const saved=root.document.component_order||[];
 const sourceOrder=(root.document.source_section_order||[]).map(recipeName);
 const rank=(entry:RecipeComponent)=>{
  const fixed=saved.indexOf(entry.id);if(fixed>=0)return fixed;
  if(saved.length)return Number.MAX_SAFE_INTEGER;
  const index=sourceOrder.indexOf(recipeName(entry.name||''));if(index>=0)return index;
  const doc=entry.recipe?.document;
  return doc&&source&&recipeName(doc.source_name||'')===source&&Number.isInteger(doc.source_section_index)&&Number(doc.source_section_index)>=0?Number(doc.source_section_index):Number.MAX_SAFE_INTEGER;
 };
 return ordered.sort((a,b)=>rank(a)-rank(b));
}
// Legacy recipes retain their visible sequence when saved, independently of costing links.
export function retainRecipeComponentOrder(document:RecipeDocument,id:string,workspace:RecipeWorkspace):RecipeDocument{
 if(document.kind!=='dish'||document.component_order?.length||document.source_section_order?.length)return document;
 const root:RecipeCard={id,document,revision:0,updated_at:'',cost:{total:null,subtotal:0,missing:0,lines:[]}};
 const recipes=workspace.recipes.some(card=>card.id===id)?workspace.recipes.map(card=>card.id===id?root:card):[...workspace.recipes,root];
 const order=recipeComponents(root,{...workspace,recipes}).map(component=>component.id);
 return order.length?{...document,component_order:order}:document;
}
// A different output unit still identifies a prep. Costing validates its conversion.
export function recipePrepOptions(line:RecipeLine,workspace:RecipeWorkspace,excludedIds:string[]=[]):RecipeCard[]{
 const blocked=new Set(excludedIds),cards=new Map(workspace.recipes.map(r=>[r.id,r]));
 const unsafe=(id:string,path:string[]=[]):boolean=>{
  if(blocked.has(id)||path.includes(id)||path.length>=20)return true;
  const card=cards.get(id);if(!card)return true;
  return card.document.lines.some(l=>l.recipe_id&&unsafe(l.recipe_id,[...path,id]));
 };
 return workspace.recipes.filter(r=>r.document.kind==='prep'&&!unsafe(r.id)).sort((a,b)=>Number(recipeUnit(b.document.unit)===recipeUnit(line.unit))-Number(recipeUnit(a.document.unit)===recipeUnit(line.unit)));
}
// Store the recipe ID, not a rounded/copied price. Existing choices and quotes win.
export function linkRecipePreps(doc:RecipeDocument,workspace:RecipeWorkspace,excludedIds:string[]=[],pendingPriceIds:string[]=[]):RecipeDocument{
 let changed=false;
 const lines=doc.lines.map(line=>{
  if(line.recipe_id||line.product_id||line.ingredient_id||pendingPriceIds.includes(line.id)||workspace.prices.some(p=>p.key===`n:${line.name.trim().toLowerCase()}`))return line;
  const named=recipePrepOptions(line,workspace,excludedIds).filter(r=>recipeName(r.document.name)===recipeName(line.name)&&(!doc.source_import_id||r.document.source_import_id===doc.source_import_id));
  const compatible=named.filter(r=>line.unit.trim()&&recipeUnit(r.document.unit)===recipeUnit(line.unit));
  const matches=compatible.length?compatible:named;
  if(matches.length!==1)return line;
  const child=matches[0];
  changed=true;return {...line,recipe_id:child.id};
 });
 return changed?{...doc,lines}:doc;
}
// An explicit named output is a suggestion only; it never rewrites entered yields.
export function recipeYieldHint(doc:RecipeDocument):{name:string;quantity:string;unit:string}|null{
 const matches=[...doc.notes.matchAll(/製成\s*([^\d\n，,。；;:：]{1,30}?)\s*(\d[\d,]*(?:\.\d+)?)\s*(公斤|公克|毫升|公升|kg|ml|g|L|克|份)(?![a-z])/gi)];
 if(matches.length!==1)return null;
 const m=matches[0],quantity=m[2].replaceAll(',','');
 return Number.isFinite(Number(quantity))&&Number(quantity)>0?{name:m[1].trim(),quantity,unit:m[3]}:null;
}
export function recipeCost(doc:RecipeDocument,workspace:RecipeWorkspace,visited:string[]=[]):RecipeCost{
 const lines:RecipeCost['lines']=doc.lines.map(line=>{
  let amount:number|null=null,reason:string|null=null,price:RecipePrice|null=null;
  const q=Number(line.quantity);
  if(!Number.isFinite(q)||q<=0||!line.unit.trim())reason='待填用量';
  else if(line.recipe_id){
   const child=workspace.recipes.find(r=>r.id===line.recipe_id);
   if(!child||visited.includes(child.id)||visited.length>20)reason='備料引用無效或循環';
   else{
    const cost=recipeCost(child.document,workspace,[...visited,child.id]);const yieldQty=Number(child.document.yield);
    if(cost.total===null)reason='備料成本未完整';
    else if(!Number.isFinite(yieldQty)||yieldQty<=0)reason='待填製成量';
    else if(recipeUnit(child.document.unit)!==recipeUnit(line.unit))reason='待確認單位換算';
    else amount=cost.total*q*recipeFactor(line.unit)/(yieldQty*recipeFactor(child.document.unit));
   }
  }else{
   const key=line.ingredient_id?`i:${line.ingredient_id}`:line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
   const basis=recipeNoteBasis(line,doc.notes);
   const compatible=basis&&recipeUnit(basis.unit)===recipeUnit(line.unit)&&basis.countUnit!==recipeUnit(line.unit);
   const piece=compatible?(workspace.prices.find(p=>p.key===key&&p.unit===basis.countUnit)||workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit)&&recipeUnit(p.purchase?.unit||'')===basis.countUnit)):undefined;
   price=piece||workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||null;
   if(piece&&compatible){const each=piece.unit===basis.countUnit?Number(piece.cost_price??piece.price):Number(piece.purchase?.cost_unit_price??recipePurchaseUnitAmount(piece));if(Number.isFinite(each)&&each>=0)amount=each*q*recipeFactor(line.unit)*basis.count/(basis.quantity*recipeFactor(basis.unit));else reason='待補價格或換算';}
   else if(!price||!Number.isFinite(Number(price.cost_price??price.price))||Number(price.cost_price??price.price)<0)reason='待補價格或換算';
   else if(['顆','片'].includes(recipeUnit(price.purchase?.unit||''))&&recipeUnit(line.unit)!==recipeUnit(price.purchase?.unit||''))reason='備註待補換算';
   else amount=Number(price.cost_price??price.price)*q*recipeFactor(line.unit);
  }
  return{id:line.id,amount,reason,price};
 });
 const missing=lines.length?lines.filter(l=>l.amount===null).length:1;
 const subtotal=lines.reduce((n,l)=>n+(l.amount??0),0);
 return{lines,missing,subtotal,total:missing?null:subtotal};
}
export const emptyRecipe=():RecipeDocument=>({name:'',kind:'dish',yield:'1',unit:'份',lines:[],notes:''});
// Import is an editable draft. Preserve source text; never silently infer yields or discard unresolved text.
export function parseRecipeText(text:string,name:string):RecipeDocument[]{
 const sections=text.split(/(?=【[^】]+】)/).filter(s=>s.trim());
 const docs:RecipeDocument[]=[];
 const yieldPattern=/製成\s*([\d,.]+)\s*(公斤|公克|公升|毫升|kg|ml|g|L|克|份)/i;
 const header=(section:string)=>section.trim().split(/\n/)[0];
 const oneServing=(section:string)=>!yieldPattern.test(header(section))&&/一份(?:量)?\s*$/.test(header(section));
 const servingNames=sections.flatMap(section=>{const h=section.match(/^【([^】]+)】/);return h&&(/^(出餐|成品|出餐菜色)$/.test(h[1].trim())||oneServing(section))?[h[1]]:[];});
 const headings=sections.map(section=>section.match(/^【([^】]+)】/)?.[1]).filter((heading):heading is string=>!!heading);
 // A named cooking section is a component, even when it makes one serving.
 // Keep every source heading visible under a separate whole-dish card.
 const nestedServing=headings.length>1&&servingNames.length===1&&!/^(出餐|成品|出餐菜色)$/.test(servingNames[0].trim())?servingNames[0]:null;
 const sourceOrder=headings.filter(heading=>!!nestedServing||!servingNames.includes(heading));
 for(const section of sections){
  const heading=section.match(/^【([^】]+)】/),yieldMatch=section.match(yieldPattern),single=!!heading&&oneServing(section);
  const portion=header(section).match(/一份(?:量)?\s*([\d,.]+)\s*(公斤|公克|公升|毫升|kg|ml|g|L|克|份)/i);
  const body=section.replace(/^【[^】]+】/,'').replace(yieldPattern,'').replace(/一份(?:量)?\s*[\d,.]+\s*(?:公斤|公克|公升|毫升|kg|ml|g|L|克|份)/gi,'');
  const lines:RecipeLine[]=[];
  for(const raw of body.split(/\n/)){
   const m=raw.trim().match(/^(.+?)\s*([\d,.]+)\s*(kg|ml|g|公克|公斤|克|顆|片|份|瓶|包|L)(?:\s*\([^)]*\))?\s*$/i);
   if(m)lines.push({id:crypto.randomUUID(),name:m[1].trim(),quantity:m[2].replaceAll(',',''),unit:m[3]});
  }
  if(!heading&&!lines.length)continue;
  const isDish=heading&&servingNames.length?servingNames.includes(heading[1])&&heading[1]!==nestedServing:!yieldMatch;
  docs.push({name:single&&servingNames.length===1&&!nestedServing?name:heading?heading[1].trim():name,kind:isDish?'dish':'prep',yield:yieldMatch?yieldMatch[1].replaceAll(',',''):single?'1':'',unit:yieldMatch?yieldMatch[2]:'份',lines,notes:section.trim(),source_name:name,source_section_name:heading?.[1].trim(),source_section_order:sourceOrder,source_section_index:heading?sourceOrder.indexOf(heading[1]):undefined,...(portion?{portion_quantity:portion[1].replaceAll(',',''),portion_unit:portion[2]}:{})});
 }
 if(nestedServing)docs.push({...emptyRecipe(),name,source_name:name,source_section_order:sourceOrder,lines:[{id:crypto.randomUUID(),name:nestedServing.trim(),quantity:'1',unit:'份'}]});
 return docs.length?docs:[{...emptyRecipe(),name,notes:text,source_name:name}];
}

export function recipePortionCost(doc:RecipeDocument,cost:RecipeCost):number|null {
 const quantity=Number(doc.portion_quantity),yieldQty=Number(doc.yield);
 if(cost.total===null||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(yieldQty)||yieldQty<=0||recipeUnit(doc.portion_unit||doc.unit)!==recipeUnit(doc.unit))return null;
 return cost.total*quantity*recipeFactor(doc.portion_unit||doc.unit)/(yieldQty*recipeFactor(doc.unit));
}

export type RecipePurchase={amount:number;quantity:number;unit:string;content_quantity?:number;content_unit?:string;cost_unit_price?:number};
export function normalizeRecipePurchase(purchase:RecipePurchase,targetUnit:string){
 if(!Number.isFinite(purchase.amount)||purchase.amount<0||!Number.isFinite(purchase.quantity)||purchase.quantity<=0||!purchase.unit.trim()||!targetUnit.trim())throw Error('請填採購金額、數量與單位。');
 const unit=recipeUnit(targetUnit);
 let baseQuantity=purchase.quantity*recipeFactor(purchase.unit);
 if(recipeUnit(purchase.unit)!==unit){
  if(!purchase.content_unit||recipeUnit(purchase.content_unit)!==unit||!Number.isFinite(purchase.content_quantity)||Number(purchase.content_quantity)<=0)throw Error(`請確認每 1 ${purchase.unit} 可換算多少 ${targetUnit}。`);
  baseQuantity=purchase.quantity*Number(purchase.content_quantity)*recipeFactor(purchase.content_unit);
 }
 const price=purchase.amount/baseQuantity;
 if(!Number.isFinite(baseQuantity)||baseQuantity<=0||!Number.isFinite(price))throw Error('換算數量無效，請重新確認。');
 let costPrice:number|null=null;
 if(purchase.cost_unit_price!==undefined){
  if(!Number.isFinite(purchase.cost_unit_price)||purchase.cost_unit_price<purchase.amount/purchase.quantity)throw Error('高估單價不可低於採購單價。');
  costPrice=purchase.cost_unit_price*purchase.quantity/baseQuantity;
  if(!Number.isFinite(costPrice))throw Error('高估單價無效。');
 }
 return {unit,price,baseQuantity,costPrice};
}

// A suggestion only: existing recipe quantities change after explicit user confirmation.
export function recipeCountHint(name:string){
 const match=name.trim().match(/^(.+?)\s*[(（]\s*([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片|份|包|瓶|盒)\s*[)）]$/i);
 return match&&Number(match[2])>0?{name:match[1].trim(),quantity:match[2],unit:recipeUnit(match[3])}:null;
}
export function recipePurchaseUnitAmount(price:RecipePrice):number{
 return price.purchase&&price.purchase.quantity>0?price.purchase.amount/price.purchase.quantity:Number(price.price);
}

// Use an explicit count from the original recipe only when it describes this exact
// ingredient and current amount. Never reinterpret a weight as a piece count.
export function recipeSourceCount(line:RecipeLine,sourceText:string){
 const named=recipeCountHint(line.name),baseName=(named?.name||line.name).replace(/\s+/g,'');
 const matches=sourceText.split(/\n/).flatMap(raw=>{
  const m=raw.trim().match(/^(.+?)\s*([\d]+(?:\.\d+)?)\s*(kg|g|公克|公斤|克|台斤|臺斤|斤|ml|l|公升|毫升)\s*[(（]\s*([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片|份|包|瓶|盒)\s*[)）]\s*$/i);
  return m&&m[1].replace(/\s+/g,'')===baseName?[{name:m[1].trim(),amount:Number(m[2]),amountUnit:m[3],quantity:m[4],unit:recipeUnit(m[5])}]:[];
 });
 if(matches.length){
  const first=matches[0];
  if(named&&(Number(named.quantity)!==Number(first.quantity)||named.unit!==first.unit))return null;
  if(!line.quantity.trim()||!Number.isFinite(Number(line.quantity)))return null;
  if(matches.some(m=>m.amount*recipeFactor(m.amountUnit)!==first.amount*recipeFactor(first.amountUnit)||recipeUnit(m.amountUnit)!==recipeUnit(first.amountUnit)||m.quantity!==first.quantity||m.unit!==first.unit))return null;
  if(Number(first.quantity)<=0||Number(first.amount)<=0||recipeUnit(line.unit)!==recipeUnit(first.amountUnit)||Math.abs(Number(line.quantity)*recipeFactor(line.unit)-first.amount*recipeFactor(first.amountUnit))>1e-9)return null;
  return {name:named?.name||line.name,quantity:first.quantity,unit:first.unit};
 }
 return named&&recipeUnit(line.unit)!==named.unit?named:null;
}
// Notes describe a costing equivalence. They never replace the recipe quantity.
export type RecipeNoteBasis={quantity:number;unit:string;count:number;countUnit:string};
export function recipeNoteBasis(line:RecipeLine,sourceText=''):RecipeNoteBasis|null{
 const pattern=/^([\d]+(?:\.\d+)?)\s*(kg|g|公克|公斤|克|台斤|臺斤|斤|ml|l|公升|毫升)\s*(?:[（(]\s*|(?:使用|約用|約需|需|用|=|＝)\s*)([\d]+(?:\.\d+)?)\s*(顆|個|pcs?|片)(?:蛋黃|雞蛋|蛋)?\s*[)）]?\s*$/i;
 const parse=(text:string):RecipeNoteBasis|null=>{const m=text.trim().match(pattern);return m&&Number(m[1])>0&&Number(m[3])>0?{quantity:Number(m[1]),unit:m[2],count:Number(m[3]),countUnit:recipeUnit(m[4])}:null;};
 if(line.note!==undefined)return parse(line.note);
 const name=(recipeCountHint(line.name)?.name||line.name).replace(/\s+/g,'');
 const matches=sourceText.split(/\n/).flatMap(raw=>{const m=raw.trim().match(/^(.+?)\s*([\d].*)$/);const parsed=m&&m[1].replace(/\s+/g,'')===name?parse(m[2]):null;return parsed?[parsed]:[];});
 if(!matches.length)return null;
 const first=matches[0];return matches.every(m=>m.quantity*recipeFactor(m.unit)===first.quantity*recipeFactor(first.unit)&&recipeUnit(m.unit)===recipeUnit(first.unit)&&m.count===first.count&&m.countUnit===first.countUnit)?first:null;
}
export function recipeNoteText(line:RecipeLine,sourceText=''){
 const basis=recipeNoteBasis(line,sourceText);return line.note??(basis?`${basis.quantity} ${basis.unit} 使用 ${basis.count} ${basis.countUnit}`:'');
}

// Keep an explicit 1,000g/ml source readable as a kilogram/litre, without inferring a package.
export function recipePurchaseDisplay(p:RecipePurchase):RecipePurchase{
 if(!p.content_quantity&&['g','ml'].includes(p.unit)&&p.quantity>=1000)return {...p,amount:p.amount/p.quantity*1000,quantity:1,unit:p.unit==='g'?'公斤':'L',...(p.cost_unit_price===undefined?{}:{cost_unit_price:p.cost_unit_price*1000})};
 return p;
}
