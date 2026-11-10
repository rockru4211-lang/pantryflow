import type {ReviewAccount,ReviewDraft} from './receipt-review.ts';
import {bindingFor,chooseReceiptIngredient,clearReceiptIngredient,ingredientLabel,matchReceiptIngredient,receiptIngredientOptions,type IngredientMatching} from './receipt-ingredient-matching.ts';
import {recipeFactor,recipeUnit} from './recipe-model.ts';
import {parsePurchaseSpecification} from './purchase-specification.ts';
import {applyReviewCategoryDefaults,changeReviewLine,isFreightName,type ReviewCategoryContext} from './receipt-review.ts';
import {hasReceiptItemCategory,knownReceiptItemCategory,lastSupplierReceiptCategories} from './receipt-categories.ts';
export type SupplierItem={name:string;unit:string;specification:string;price:number|null;date:string;supplier?:string;category?:string;confirmed?:true};
/** Saved history only; never mix removed records or raw, unreviewed OCR. */
export function supplierItems(rows:ReviewAccount[],supplier:string,currentBatch:string):SupplierItem[]{
 const items=new Map<string,SupplierItem>();
 for(const row of [...rows].filter(r=>r.batch_id!==currentBatch&&r.record_state==='LIVE'&&(!supplier.trim()||r.supplier_name.trim()===supplier.trim())&&(r.edit_revision>0||r.status==='CHECKED')).sort((a,b)=>(b.receipt_date||'').localeCompare(a.receipt_date||''))){
  const confirmed=!row.pending&&!row.source_changed&&!row.amount_conflict&&row.status!=='RECHECK'&&(row.review_completed||row.reviewed||row.status==='CHECKED');
  for(const line of row.lines){if(!line.product_name.trim()||!line.unit.trim()||line.handling&&line.handling!=='NORMAL')continue;
   const key=JSON.stringify([row.supplier_name.trim(),line.product_name.trim(),line.unit.trim(),line.specification||'']);
   const previous=items.get(key);
   if(previous){if(confirmed)previous.confirmed=true;continue;}
   items.set(key,{name:line.product_name.trim(),unit:line.unit.trim(),specification:line.specification||'',price:line.unit_price,date:row.receipt_date||'',supplier:row.supplier_name,category:line.category,...(confirmed?{confirmed:true as const}:{})});
  }
 }
 return [...items.values()];
}
export function applySupplierItem(draft:ReviewDraft,index:number,item:SupplierItem,context:ReviewCategoryContext={}){
 if(!draft.lines[index])return draft;
 let next=changeReviewLine(draft,index,'product_name',item.name);
 next=changeReviewLine(next,index,'unit',item.unit);
 next=changeReviewLine(next,index,'specification',item.specification);
 if(!draft.lines[index].unit_price.trim()&&item.price!==null&&Number.isFinite(item.price)&&item.price>=0&&(!draft.lines[index].handling||draft.lines[index].handling==='NORMAL'))next=changeReviewLine(next,index,'unit_price',String(item.price));
 const category=knownReceiptItemCategory(item.category),line=next.lines[index];
 if(line.categorySource!=='manual'&&category&&(!hasReceiptItemCategory(line.category)||!!line.categorySource))next={...next,lines:next.lines.map((value,i)=>i===index?{...value,category,categorySource:'item'}:value)};
 // Only the chosen row is new input; selecting history must not reclassify other saved rows.
 const classified=applyReviewCategoryDefaults({...next,lines:[next.lines[index]]},{...context,original:undefined});
 return classified.lines[0]===next.lines[index]?next:{...next,lines:next.lines.map((value,i)=>i===index?classified.lines[0]:value)};
}

export function matchSupplierItems(items:SupplierItem[],query:string,limit=8):SupplierItem[]{
 const words=query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(item=>words.every(word=>`${item.name} ${item.specification} ${item.supplier||""}`.normalize("NFKC").toLocaleLowerCase().includes(word))).slice(0,limit);
}

export type ReceiptSupplierChoice={id:string;name:string;aliases?:string[];is_active?:boolean;is_removed?:boolean;supplier_category?:string};
const keywordKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
export type SharedReceiptProduct={
 id:string;name:string;product_code:string|null;base_unit:string|null;specification:string|null;supplierConfirmed?:boolean;
};
type ReceiptProductDetails=Pick<ReviewDraft['lines'][number],'unit'|'specification'>;
type SharedReceiptSearch={catalog?:IngredientMatching;supplier?:string;history?:SupplierItem[]};

function specificationKey(value:string){
 const spec=parsePurchaseSpecification(value);
 return spec?`${Number(spec.quantity)*recipeFactor(spec.unit)}:${recipeUnit(spec.unit)}`:keywordKey(value);
}

function receiptProductIdentity(name:string,unit:string,specification:string){
 return JSON.stringify([keywordKey(name),recipeUnit(unit),specificationKey(specification)]);
}
function supplierProductIdentity(name:string,unit:string,specification:string){
 return `${recipeFactor(unit)}:${receiptProductIdentity(name,unit,specification)}`;
}
export function sameReceiptProduct(item:SupplierItem,product:SharedReceiptProduct){
 return supplierProductIdentity(product.name,product.base_unit||'',product.specification||'')===supplierProductIdentity(item.name,item.unit,item.specification);
}

export function unambiguousReceiptProducts(products:SharedReceiptProduct[]){
 const eligible=products.filter(product=>product.name.trim()&&product.name.trim()!=='未命名品項'&&!isFreightName(product.name)&&product.base_unit?.trim());
 const counts=new Map<string,number>();
 for(const product of eligible){
  const key=receiptProductIdentity(product.name,product.base_unit||'',product.specification||'');
  counts.set(key,(counts.get(key)||0)+1);
 }
 return eligible.filter(product=>counts.get(receiptProductIdentity(product.name,product.base_unit||'',product.specification||''))===1);
}

function compatibleReceiptProduct(line:ReceiptProductDetails,product:SharedReceiptProduct){
 return !!product.base_unit?.trim()
  &&(!line.unit.trim()||recipeUnit(line.unit)===recipeUnit(product.base_unit))
  &&(!line.specification.trim()||specificationKey(line.specification)===specificationKey(product.specification||''));
}

export function matchSharedReceiptProducts(products:SharedReceiptProduct[],query:string,line:ReceiptProductDetails,limit=8,context:SharedReceiptSearch={}){
 const key=keywordKey(query);
 if(!key)return [];
 const byName=new Map<string,SharedReceiptProduct[]>();
 for(const product of products){const name=keywordKey(product.name);const group=byName.get(name)||[];group.push(product);byName.set(name,group);}
 const aliases=new Map<string,string[]>();
 const supplierKey=keywordKey(context.supplier||'');
 const history=(context.history||[]).filter(item=>supplierKey&&item.confirmed&&keywordKey(item.supplier||'')===supplierKey);
 const confirmed=new Set(history.map(item=>supplierProductIdentity(item.name,item.unit,item.specification)));
 const supplierBindings=new Map<string,IngredientMatching['bindings']>();
 for(const binding of context.catalog?.bindings||[]){
  if(!supplierKey||binding.stopped||keywordKey(binding.supplier)!==supplierKey)continue;
  const list=supplierBindings.get(binding.ingredient_id)||[];list.push(binding);supplierBindings.set(binding.ingredient_id,list);
 }
 if(context.catalog)for(const ingredient of receiptIngredientOptions(context.catalog)){
  const purchase=ingredient.purchase;
  const matches=(byName.get(keywordKey(ingredientLabel(ingredient.name)))||[]).filter(product=>compatibleReceiptProduct({
   unit:purchase?.unit||ingredient.unit,specification:purchase?.content_quantity?`${purchase.content_quantity}${purchase.content_unit||''}`:'',
  },product));
  if(matches.length!==1)continue;
  const product=matches[0];
  const identity=supplierProductIdentity(product.name,product.base_unit||'',product.specification||'');
  const bindings=(supplierBindings.get(ingredient.id)||[]).filter(binding=>supplierProductIdentity(product.name,binding.unit,binding.specification)===identity);
  aliases.set(product.id,[...(aliases.get(product.id)||[]),...ingredient.aliases,...ingredient.recipe_aliases||[],...bindings.map(binding=>binding.name)]);
  if(bindings.length)confirmed.add(identity);
 }
 return products.flatMap(product=>{
  if(!compatibleReceiptProduct(line,product))return [];
  const names=[product.name,product.product_code||'',...aliases.get(product.id)||[]].map(keywordKey);
  const exact=names.includes(key);
  if(!exact&&!names.some(value=>value.includes(key))&&!keywordKey(product.specification||'').includes(key))return [];
  return [{product:{...product,supplierConfirmed:confirmed.has(supplierProductIdentity(product.name,product.base_unit||'',product.specification||''))},exact}];
 }).sort((a,b)=>Number(b.product.supplierConfirmed)-Number(a.product.supplierConfirmed)||Number(b.exact)-Number(a.exact)).slice(0,limit).map(({product})=>product);
}

export function keepReceiptProductName(draft:ReviewDraft,index:number,original?:string){
 return {...draft,lines:draft.lines.map((line,i)=>i===index?clearReceiptIngredient({...line,product_name:original||line.product_name}):line)};
}

export function applySharedReceiptProduct(draft:ReviewDraft,index:number,product:SharedReceiptProduct,context:ReviewCategoryContext={}){
 const current=draft.lines[index];
 if(!current||current.handling&&current.handling!=='NORMAL'||!compatibleReceiptProduct(current,product))return draft;
 const unit=current.unit.trim()?current.unit:product.base_unit||'';
 const specification=product.specification||current.specification;
 if(current.product_name===product.name&&current.unit===unit&&current.specification===specification)return draft;
 let next={...clearReceiptIngredient(current),product_name:product.name,unit,specification};
 if(next.categorySource==='item'&&current.product_name!==product.name){
  next.category='待分類';
  delete next.categorySource;
 }
 // Only a name already present on the source receipt can become an alias.
 const source=context.original?.lines.find(line=>line.row_key===current.row_key);
 const sourceName=source?.supplier_item_name||source?.source_product;
 if(context.catalog&&sourceName&&draft.supplier.trim()){
  const ingredient=matchReceiptIngredient(context.catalog,'',{...next,ingredient_id:undefined});
  if(ingredient&&keywordKey(ingredientLabel(ingredient.name))===keywordKey(product.name)){
   const alias={...next,supplier_item_name:sourceName,supplier_item_unit:source?.supplier_item_unit??source?.unit??unit,
    supplier_item_specification:source?.supplier_item_specification??source?.specification??specification};
   const previous=bindingFor(context.catalog,draft.supplier,alias);
   if(!previous||!previous.stopped&&previous.ingredient_id===ingredient.id){
    next={...chooseReceiptIngredient(alias,ingredient,context.catalog,draft.supplier),product_name:product.name,unit,specification};
   }
  }
 }
 const classified=applyReviewCategoryDefaults({...draft,lines:[next]},{...context,original:undefined});
 return {...draft,lines:draft.lines.map((value,i)=>i===index?classified.lines[0]:value)};
}

export function matchReceiptSuppliers(rows:ReceiptSupplierChoice[],query:string){
 const key=keywordKey(query);
 return rows.filter(row=>row.is_active!==false&&!row.is_removed&&[row.name,...row.aliases||[]].some(name=>keywordKey(name).includes(key))).slice(0,8);
}
export function receiptItemQuery(value:string){return value==='未命名品項'?'':value;}
export function itemsForSupplier(items:SupplierItem[],supplier:string){
 const key=keywordKey(supplier);if(!key)return items;
 const exact=items.filter(item=>keywordKey(item.supplier||'')===key);
 return exact.length?exact:items.filter(item=>keywordKey(item.supplier||'').includes(key));
}

export function exactReceiptSupplier(rows:ReceiptSupplierChoice[],name:string){
 const key=keywordKey(name);return key?rows.find(row=>[row.name,...row.aliases||[]].some(n=>keywordKey(n)===key)):undefined;
}

/** A supplier fragment is a search query, not authorization to use another supplier's defaults. */
export function supplierReceiptCategory(rows:ReceiptSupplierChoice[],name:string){
 const supplier=exactReceiptSupplier(rows,name);
 return supplier&&supplier.is_active!==false&&!supplier.is_removed?knownReceiptItemCategory(supplier.supplier_category):'';
}

/** Reuse the last confirmed document choice across canonical names and complete aliases. */
export function defaultSupplierReceiptCategories(history:ReviewAccount[],suppliers:ReceiptSupplierChoice[],name:string,batchId:string){
 const supplier=exactReceiptSupplier(suppliers,name);
 if(supplier&&(supplier.is_active===false||supplier.is_removed))return [];
 const remembered=lastSupplierReceiptCategories(history,name,batchId,supplier?[supplier.name,...supplier.aliases||[]]:[]);
 if(remembered.length)return remembered;
 const category=supplierReceiptCategory(suppliers,name);
 return category?[category]:[];
}

/** Saved unit choices include freight units and exclude raw OCR/test/removed records. */
export function receiptSavedUnits(rows:ReviewAccount[]){
 return [...new Set(rows.filter(r=>r.record_state==='LIVE'&&(r.edit_revision>0||r.status==='CHECKED')).flatMap(r=>r.lines.map(l=>l.unit.trim())).filter(Boolean))];
}
