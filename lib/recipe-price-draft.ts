import {recipeComponents,recipePurchaseDisplay,recipeCost,normalizeRecipePurchase,recipePurchaseUnitAmount,recipeUnit,recipeNoteBasis,recipeLinePrices,type RecipeDocument,type RecipeLine,type RecipePrice,type RecipePurchase,type RecipeWorkspace} from './recipe-cost.ts';
export type RecipePriceDraft={amount:string;rawAmount:string|null;unit:string;content:string;contentUnit:string;source:string;date:string;amountEdited?:boolean;referenceId?:string;supplierName?:string;supplierId?:string|null};
export const recipePriceKey=(line:Pick<RecipeLine,'name'|'product_id'|'ingredient_id'>)=>line.ingredient_id?`i:${line.ingredient_id}`:line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
export function findRecipePrice(line:RecipeLine,workspace:RecipeWorkspace){const key=recipePriceKey(line),prices=recipeLinePrices(line,workspace);return prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||prices.find(p=>p.key===key);}
export function recipePriceDraft(line:RecipeLine,workspace:RecipeWorkspace,sourceText=''):RecipePriceDraft{
 const basis=recipeNoteBasis(line,sourceText),prices=recipeLinePrices(line,workspace);
 const found=(basis?prices.find(p=>p.key===recipePriceKey(line)&&p.unit===basis.countUnit):undefined)||findRecipePrice(line,workspace);
 const countMismatch=found&&['顆','片'].includes(recipeUnit(line.unit))&&found.unit!==recipeUnit(line.unit)&&recipeUnit(found.purchase?.unit||'')!==recipeUnit(line.unit);
 const previous=countMismatch?undefined:found,purchase=previous?.purchase?recipePurchaseDisplay(previous.purchase):null;
 const unit=(countMismatch?line.unit:'')||purchase?.unit||previous?.unit||basis?.countUnit||workspace.products.find(p=>p.id===line.product_id)?.unit||line.unit||'g';
 const legacyBasis=basis&&purchase&&(purchase as {conversion_basis?:string}).conversion_basis!=='package'&&basis.countUnit===recipeUnit(purchase.unit)&&recipeUnit(basis.unit)===recipeUnit(line.unit)?basis:null;
 const raw=previous?recipePurchaseUnitAmount({...previous,purchase}):null;
 const cost=purchase?.cost_unit_price??(previous?.cost_price!=null&&previous.price>0&&raw!==null?raw*previous.cost_price/previous.price:previous?.cost_price??raw);
 return {amount:cost===null?'':String(cost),rawAmount:raw===null?null:String(raw),unit,content:legacyBasis?String(legacyBasis.quantity/legacyBasis.count):purchase?.content_quantity?String(purchase.content_quantity):'',contentUnit:legacyBasis?.unit||purchase?.content_unit||line.unit,source:previous?.source||'手動補價',referenceId:previous?.reference_id,supplierName:previous?.supplier_name||previous?.source_ref?.supplier_name,supplierId:previous?.source_ref?.supplier_id,date:previous?.reference_id?(previous.effective_date||''):previous?.effective_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
}
export function normalizeRecipeDraft(draft:RecipePriceDraft,targetUnit:string){
 if(!draft.amount.trim())throw Error('請填單價。');
 const amount=Number(draft.amount),raw=draft.rawAmount===null?amount:Number(draft.rawAmount);
 if(draft.rawAmount!==null&&!draft.rawAmount.trim())throw Error('請填原始進價，或選擇使用填寫單價。');
 if(!Number.isFinite(amount)||amount<0||!Number.isFinite(raw)||raw<0)throw Error('單價需為零或正數。');
 if(amount<raw)throw Error('成本單價低於原始進價，請在價格設定核對進價。');
 if(!draft.source.trim()||(!draft.date&&!draft.referenceId))throw Error('請填價格來源與日期。');
 const needsConversion=recipeUnit(draft.unit)!==recipeUnit(targetUnit);
 const purchase:RecipePurchase&{conversion_basis?:string}={amount:raw,quantity:1,unit:draft.unit,...(needsConversion||draft.content.trim()?{content_quantity:Number(draft.content),content_unit:draft.contentUnit,conversion_basis:'package'}:{}),...(amount>raw?{cost_unit_price:amount}:{})};
 return {...normalizeRecipePurchase(purchase,targetUnit),purchase};
}
export function changeRecipePriceUnit(draft:RecipePriceDraft,next:string):RecipePriceDraft{
 // Changing the label is an explicit edit, never an instruction to erase input.
 return {...draft,unit:next,rawAmount:null,referenceId:undefined,source:'手動補價',amountEdited:true,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
}
export function normalizeRecipeLineDraft(line:RecipeLine,draft:RecipePriceDraft,sourceText=''){
 if(recipeUnit(draft.unit)!==recipeUnit(line.unit)&&!draft.content.trim()){
  const basis=recipeNoteBasis(line,sourceText);
  if(basis&&basis.countUnit===recipeUnit(draft.unit)&&recipeUnit(basis.unit)===recipeUnit(line.unit))return normalizeRecipeDraft(draft,draft.unit);
 }
 return normalizeRecipeDraft(draft,recipeUnit(draft.unit)!==recipeUnit(line.unit)&&!draft.content.trim()?draft.unit:line.unit);
}
export function draftRecipePrice(line:RecipeLine,draft:RecipePriceDraft,sourceText=''):RecipePrice{
 const n=normalizeRecipeLineDraft(line,draft,sourceText);
 return {key:recipePriceKey(line),name:line.name,product_id:line.product_id||null,unit:n.unit,price:n.price,cost_price:n.costPrice,purchase:n.purchase,source:draft.source,effective_date:draft.date||null,reference_id:draft.referenceId,recorded_at:new Date().toISOString()};
}

// The editor previews entered/current prices; it must never read a saved cost lock.
// The original workspace and approvals remain untouched for lists, exports and confirmation.
export function recipeEditorPreview(document:RecipeDocument,workspace:RecipeWorkspace,drafts:Record<string,RecipePriceDraft>):RecipeWorkspace{
 const preview:RecipeWorkspace={...workspace,cost_mode:Object.keys(drafts).length?'latest':workspace.pricing_loaded===false?undefined:'latest',prices:[...workspace.prices]};
 // While current prices load, show the server-saved per-line costs in the editor.
 if(workspace.pricing_loaded===false)preview.recipes=workspace.recipes.map(card=>card.cost?({...card,approved_cost:{id:card.approved_cost?.id||'',at:card.updated_at,origin:'saved_version',document:card.document,cost:card.cost}}):card);
 for(const line of document.lines){
  const draft=drafts[line.id];if(!draft||line.recipe_id)continue;
  const key=recipePriceKey(line),units=[recipeUnit(line.unit),recipeUnit(draft.unit),recipeNoteBasis(line,document.notes)?.countUnit];
  preview.prices=preview.prices.filter(price=>!(price.key===key&&units.includes(price.unit)));
  try{preview.prices.unshift(draftRecipePrice(line,draft,document.notes));}
  catch{/* Invalid input stays pending instead of falling back to an old price. */}
 }
 return preview;
}

// Rank comparable records first without adopting a quote or changing its value.
export function recipePriceCandidates(line:RecipeLine,workspace:RecipeWorkspace){
 const rank=(p:RecipePrice)=>(!p.conversion_pending&&recipeUnit(p.unit)===recipeUnit(line.unit)?4:0)+(!p.source_ref?.missing_price&&Number.isFinite(p.price)&&p.price>=0?2:0)+(p.effective_date?1:0);
 const sorted=(workspace.price_candidates||[]).filter(p=>p.key===recipePriceKey(line)).slice().sort((a,b)=>rank(b)-rank(a)||(b.effective_date||'').localeCompare(a.effective_date||'')||(b.recorded_at||'').localeCompare(a.recorded_at||''));
 const seen=new Set<string>();return sorted.filter(p=>{const key=JSON.stringify([p.name,p.unit,p.price,p.cost_price,p.purchase,p.supplier_name||p.source_ref?.supplier_name,p.source_ref?.specification,p.source,p.conversion_pending]);if(seen.has(key))return false;seen.add(key);return true;});
}

// Only exact identities with complete, compatible prices can be filled automatically.
// Equal-date conflicts remain pending; undated history is usable only when values agree.
export function recipeUsablePriceDraft(line:RecipeLine,workspace:RecipeWorkspace,sourceText=''):RecipePriceDraft|undefined{
 if(line.recipe_id||findRecipePrice(line,workspace))return;
 const candidates=recipePriceCandidates(line,workspace).filter(p=>!p.conversion_pending&&!p.source_ref?.missing_price&&p.reference_id&&recipeUnit(p.unit)===recipeUnit(line.unit));
 const usable=candidates.flatMap(price=>{try{const draft=recipePriceDraft(line,{...workspace,prices:[price]},sourceText),normalized=normalizeRecipeLineDraft(line,draft,sourceText);return [{price,draft,value:normalized.costPrice??normalized.price,unit:normalized.unit}];}catch{return [];}});
 if(!usable.length)return;
 const dated=usable.filter(row=>row.price.effective_date).sort((a,b)=>b.price.effective_date!.localeCompare(a.price.effective_date!));
 const choices=dated.length?dated.filter(row=>row.price.effective_date===dated[0].price.effective_date):usable;
 if(choices.some(row=>row.unit!==choices[0].unit||Math.abs(row.value-choices[0].value)>0.000001))return;
 return choices[0].draft;
}
export function recipeInitialPriceDrafts(document:RecipeDocument,workspace:RecipeWorkspace,saved:Record<string,RecipePriceDraft>={}){
 const drafts={...saved};
 for(const line of document.lines){
  if(drafts[line.id])continue;
  const locked=workspace.recipes.some(card=>card.document.lines.some(old=>old.id===line.id)&&card.cost?.lines.some(cost=>cost.id===line.id&&cost.amount!==null));
  if(locked)continue;
  const draft=recipeUsablePriceDraft(line,workspace,document.notes);if(draft)drafts[line.id]=draft;
 }
 return drafts;
}

// Saved values remain the editing baseline; only deliberately edited prices are trialled.
export function recipeEditorDisplayCost(document:RecipeDocument,workspace:RecipeWorkspace,drafts:Record<string,RecipePriceDraft>,recipeId:string){
 const savedWorkspace={...workspace,cost_mode:undefined,recipes:workspace.recipes.map(card=>card.cost?({...card,approved_cost:{id:card.approved_cost?.id||'',at:card.updated_at,origin:'saved_version',document:card.approved_cost?.document||card.document,cost:card.cost}}):card)};
 const lines=document.lines.map(line=>{
  const one={...document,lines:[line]};
  const locked=recipeLockedPriceWorkspace(one,savedWorkspace,recipeId);
  const saved=recipeCost(one,locked,[recipeId]).lines[0];
  if(!drafts[line.id])return saved;
  const trial=recipeCost(one,recipeEditorPreview(one,locked,{[line.id]:drafts[line.id]}),[recipeId]).lines[0];
  return trial.amount!==null?trial:saved;
 });
 const subtotal=lines.reduce((sum,line)=>sum+(line.amount??0),0),missing=lines.length?lines.filter(line=>line.amount===null).length:1;
 return {lines,subtotal,missing,total:missing?null:subtotal};
}

// One display cost for the list, parent components and ingredient editor.
// Preserve saved non-null costs; fill missing costs and preview explicit device drafts.
export function recipeDisplayWorkspace(workspace:RecipeWorkspace,savedDrafts:Record<string,Record<string,RecipePriceDraft>>={}):RecipeWorkspace{
 const drafts=Object.fromEntries(workspace.recipes.map(card=>[card.id,recipeInitialPriceDrafts(card.document,workspace,savedDrafts[card.id]||{})]));
 let display:RecipeWorkspace={...workspace,cost_mode:undefined,recipes:workspace.recipes.map(card=>({...card,approved_cost:{id:card.approved_cost?.id||'',at:card.updated_at,origin:'saved_version',document:card.approved_cost?.document||card.document,cost:{...card.cost,lines:(card.cost?.lines||[]).map(line=>drafts[card.id]?.[line.id]&&recipeCost(card.document,recipeEditorPreview(card.document,workspace,drafts[card.id]),[card.id]).lines.find(trial=>trial.id===line.id)?.amount!=null?{...line,amount:null}:line)}}}))};
 for(const card of workspace.recipes)display=recipeEditorPreview(card.document,display,drafts[card.id]||{});
 display={...display,cost_mode:undefined};
 return {...display,recipes:display.recipes.map(card=>({...card,cost:recipeCost(card.document,display,[card.id])}))};
}

// Purchase presentation is owned by the recipe's saved snapshot, not today's catalog.
export function recipeLockedPriceWorkspace(document:RecipeDocument,workspace:RecipeWorkspace,recipeId:string):RecipeWorkspace{
 const card=workspace.recipes.find(row=>row.id===recipeId);if(!card?.cost)return workspace;
 const baseline=card.approved_cost?.document||card.document;let prices=[...workspace.prices];
 for(const line of document.lines){
  const old=baseline.lines.find(row=>row.id===line.id),quote=card.cost.lines.find(row=>row.id===line.id)?.price;
  if(!old||!quote||line.recipe_id||['name','product_id','ingredient_id','recipe_id'].some(key=>old[key as keyof RecipeLine]!==line[key as keyof RecipeLine]))continue;
  const key=recipePriceKey(line);prices=[{...quote,key},...prices.filter(price=>price.key!==key)];
 }
 return {...workspace,prices};
}
export function recipeCostChange(card:import('./recipe-model').RecipeCard,workspace:RecipeWorkspace){
 if(workspace.pricing_loaded===false||!card.cost)return null;
 const latest=recipeCost(card.document,{...workspace,cost_mode:'latest'},[card.id]);
 const changed=latest.lines.filter(line=>{const saved=card.cost.lines.find(row=>row.id===line.id);return saved?.amount!=null&&line.amount!=null&&Math.abs(saved.amount-line.amount)>0.000001;});
 if(!changed.length)return null;
 const delta=changed.reduce((sum,line)=>sum+line.amount!-card.cost.lines.find(row=>row.id===line.id)!.amount!,0);
 const before=changed.reduce((sum,line)=>sum+card.cost.lines.find(row=>row.id===line.id)!.amount!,0);
 return {count:changed.length,delta,percent:before>0?delta/before*100:null};
}

// Capture valid explicit edits in the same durable request as the recipe document.
// Incomplete inputs remain in local storage and never block saving other costs.
export function recipeCommitPrices(document:RecipeDocument,workspace:RecipeWorkspace,drafts:Record<string,RecipePriceDraft>){
 return document.lines.flatMap(line=>{
  if(line.recipe_id)return [];
  const saved=workspace.recipes.find(card=>card.document.lines.some(old=>old.id===line.id));
  const old=saved?.document.lines.find(old=>old.id===line.id);
  const locked=old&&['name','product_id','ingredient_id','recipe_id'].every(key=>old[key as keyof RecipeLine]===line[key as keyof RecipeLine])&&saved?.cost.lines.some(cost=>cost.id===line.id&&cost.amount!==null);
  // Carry a displayed quote for a new/unpriced line; never refresh an already locked line.
  const draft=drafts[line.id]||(!locked&&workspace.can_price&&findRecipePrice(line,workspace)?recipePriceDraft(line,workspace,document.notes):undefined);
  if(!draft)return [];
  try{const n=normalizeRecipeLineDraft(line,{...draft,source:draft.source||'手動補價',date:draft.date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())},document.notes);
   return [{line_id:line.id,name:line.name,ingredient_id:line.ingredient_id,ingredient_revision:workspace.ingredients?.find(i=>i.id===line.ingredient_id)?.revision,product_id:line.product_id||null,unit:n.unit,price:n.price,cost_price:n.costPrice,purchase:n.purchase,source:draft.source||'手動補價',effective_date:draft.date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),reference_id:draft.referenceId,draft_snapshot:JSON.stringify(draft)}];
  }catch{return [];}
 });
}

// Resolve each recipe's device draft independently, then let parents use that
// child's preview. A's explicit quote never becomes the shared price for B.
export function recipeLocalDraftWorkspace(workspace:RecipeWorkspace,drafts:Record<string,Record<string,RecipePriceDraft>>):RecipeWorkspace{
 const resolved=new Map<string,RecipeWorkspace['recipes'][number]>(),visiting=new Set<string>();
 const visit=(id:string)=>{const card=workspace.recipes.find(row=>row.id===id);if(!card||resolved.has(id)||visiting.has(id))return;visiting.add(id);
  for(const line of card.document.lines)if(line.recipe_id)visit(line.recipe_id);
  const children={...workspace,recipes:workspace.recipes.map(row=>resolved.get(row.id)||row)};
  const cost=recipeEditorDisplayCost(card.document,recipeLockedPriceWorkspace(card.document,children,id),drafts[id]||{},id);
  resolved.set(id,{...card,cost,approved_cost:{id:card.approved_cost?.id||'',at:card.updated_at,origin:'saved_version',document:card.document,cost}});visiting.delete(id);
 };
 for(const card of workspace.recipes)visit(card.id);
 return {...workspace,recipes:workspace.recipes.map(card=>resolved.get(card.id)||card)};
}

export function recipeFillBlankPrices(rootId:string,workspace:RecipeWorkspace,existing:Record<string,Record<string,RecipePriceDraft>>){
 const drafts:Record<string,Record<string,RecipePriceDraft>>={},visited=new Set<string>();
 let filled=0,missing=0;
 const visit=(id:string)=>{
  if(visited.has(id))return;visited.add(id);
  const card=workspace.recipes.find(row=>row.id===id);if(!card)return;
  for(const component of recipeComponents(card,workspace))if(component.recipe)visit(component.recipe.id);
  for(const child of card.document.component_order||[])visit(child);
  for(const line of card.document.lines){
   if(line.recipe_id){visit(line.recipe_id);continue;}
   const current=existing[id]?.[line.id];
   const baseline=card.approved_cost?.document||card.document;
   const old=baseline.lines.find(row=>row.id===line.id);
   const saved=card.cost?.lines.find(row=>row.id===line.id);
   const same=old&&['name','product_id','ingredient_id','recipe_id'].every(key=>old[key as keyof RecipeLine]===line[key as keyof RecipeLine]);
   if(current){if(!current.amount.trim())missing++;continue;}
   if(same&&(saved?.amount!=null||saved?.price))continue;
   const quote=findRecipePrice(line,workspace)?recipePriceDraft(line,workspace,card.document.notes):recipeUsablePriceDraft(line,workspace,card.document.notes);
   if(!quote){missing++;continue;}
   try{
    const trial=draftRecipePrice(line,quote,card.document.notes);
    const cost=recipeCost({...card.document,lines:[{...line,quantity:'1'}]},{...workspace,cost_mode:'latest',prices:[trial]},[id]);
    if(cost.total===null){missing++;continue;}
    (drafts[id]??={...existing[id]})[line.id]=quote;filled++;
   }catch{missing++;}
  }
 };
 visit(rootId);return {drafts,filled,missing};
}
