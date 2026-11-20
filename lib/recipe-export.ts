import {recipeComponents,recipeCost,recipeDisplayName,recipeNoteText,recipePortionCost,recipeFactor,recipeUnit,recipeEdibleFactor,normalizeRecipePurchase,type RecipeCard,type RecipeWorkspace,type RecipeLine,type RecipeCost} from './recipe-cost.ts';
import {recipeIngredientCode} from './ingredient-code.ts';
import {recipeDirectoryCost} from './recipe-display.ts';
export type RecipeExportEntry={card:RecipeCard;parents:string[];pendingComponents:string[]};
const validAmount=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
function savedExportCost(card:RecipeCard):RecipeCost|null{
 if(card.cost_loaded===false)return null;
 if(card.cost&&Array.isArray(card.cost.lines)&&validAmount(card.cost.subtotal))return card.cost;
 return card.approved_cost?.cost??null;
}
export function recipeExportEntries(workspace:RecipeWorkspace,ids:string[]):RecipeExportEntry[]{
 const selected=new Set(ids),entries=new Map<string,RecipeExportEntry>();
 // recipes.saved deliberately has an empty price catalog. Export its snapshots,
 // including explicit missing lines, without repricing from today's catalog.
 const savedWorkspace={...workspace,cost_mode:undefined,recipes:workspace.recipes.map(card=>{
  const cost=savedExportCost(card);return cost?{...card,approved_cost:{id:'',at:card.updated_at,origin:'saved_version',document:card.document,cost}}:card;
 })};
 function add(card:RecipeCard,parent?:string){const old=entries.get(card.id);if(old){if(parent&&!old.parents.includes(parent))old.parents.push(parent);return;}const cost=savedExportCost(card)??recipeCost(card.document,savedWorkspace,[card.id]);entries.set(card.id,{card:{...card,cost,approved_cost:{id:'',at:card.updated_at,origin:'saved_version',document:card.document,cost}},parents:parent?[parent]:[],pendingComponents:[]});}
 for(const root of workspace.recipes.filter(card=>selected.has(card.id))){add(root);const title=recipeDisplayName(root.document),components=recipeComponents(root,workspace);entries.get(root.id)!.pendingComponents=components.filter(c=>!c.recipe||!c.uses.length).map(c=>c.name);for(const component of components){if(component.recipe)add(component.recipe,title);else for(const candidate of component.candidates)add(candidate,`${title}（版本待確認）`);}}
 return [...entries.values()];
}
export function exportSummary(entry:RecipeExportEntry){
 const {card,pendingComponents}=entry,doc=card.document,cost=card.cost,complete=cost.total!==null&&!pendingComponents.length;
 const yieldQty=Number(doc.yield),unit=yieldQty>0&&Number.isFinite(yieldQty)&&cost.total!==null?cost.total/yieldQty:null;
 const status=(cost.total!==null?(pendingComponents.length?'已保存成本':'完整'):`待補齊${cost.missing?`：${cost.missing} 項價格或用量`:''}`)+(pendingComponents.length?`；配件用量／版本待確認：${pendingComponents.join('、')}`:'');
 return {complete,total:cost.total,subtotal:cost.subtotal,unit,portion:cost.total!==null?recipePortionCost(doc,cost):null,status,reference:recipeDirectoryCost(card)};
}
export function exportLineUnitCost(card:RecipeCard,line:RecipeLine):number|null{
 const saved=card.cost.lines.find(row=>row.id===line.id),quantity=Number(line.quantity);
 if(validAmount(saved?.amount)&&Number.isFinite(quantity)&&quantity>0)return saved.amount/quantity;
 const price=saved?.price,factor=recipeEdibleFactor(line);
 if(!price||factor===null)return null;
 let amount:number|null=null;
 if(recipeUnit(price.unit)===recipeUnit(line.unit)&&validAmount(price.cost_price??price.price))amount=(price.cost_price??price.price)*recipeFactor(line.unit)/recipeFactor(price.unit);
 else if(price.purchase)try{const normalized=normalizeRecipePurchase(price.purchase,line.unit);amount=(normalized.costPrice??normalized.price)*recipeFactor(line.unit);}catch{/* Unknown conversion remains pending. */}
 return validAmount(amount)?amount*factor:null;
}
const numberText=(n:number|null,digits=2)=>n===null?'待補齊':n.toLocaleString('zh-TW',{maximumFractionDigits:digits,minimumFractionDigits:digits});
export function escapeRecipeHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export function recipePrintHtml(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const e=escapeRecipeHtml,entries=recipeExportEntries(workspace,ids);
 const sections=entries.map(entry=>{
  const {card}=entry,doc=card.document,summary=exportSummary(entry),cost=card.cost;
  const rows=doc.lines.map(line=>`<tr><td>${e(line.name)}</td><td class="num">${e(line.quantity||'待填')} ${e(line.unit)}</td>${includeCost?`<td class="num">${e(numberText(exportLineUnitCost(card,line),4))}<br><small>元／${e(line.unit)}</small></td><td class="num">${e(numberText(cost.lines.find(row=>row.id===line.id)?.amount??null))}</td>`:''}<td>${e(recipeNoteText(line,doc.notes))}</td></tr>`).join('');
  const totals=includeCost?`${!summary.reference.locked&&summary.reference.amount!==null?`<p>${e(summary.reference.label)}：NT$ ${e(numberText(summary.reference.amount))}</p>`:''}<p>整份配方成本：NT$ ${e(numberText(summary.total))} · 每 ${e(doc.unit)}：NT$ ${e(numberText(summary.unit))}</p><p class="muted">${e(summary.status)}${summary.total===null?`；已計入成本 NT$ ${e(numberText(summary.subtotal))}（不是完整總成本）`:''}</p>`:'';
  return `<section><p class="muted">${e(storeName)} · ${doc.kind==='dish'?'主食譜':'附屬配方'}${entry.parents.length?` · 用於 ${e(entry.parents.join('、'))}`:''}</p><h1>${e(recipeDisplayName(doc))}</h1><p>製成量：${e(doc.yield||'待填')} ${e(doc.unit)}</p><table><thead><tr><th>食材／配件</th><th class="num">實際用量</th>${includeCost?'<th class="num">單位成本</th><th class="num">使用成本</th>':''}<th>備註</th></tr></thead><tbody>${rows}</tbody></table>${totals}<h2>作法與備註</h2><pre>${e(doc.notes||'未填寫')}</pre></section>`;
 }).join('');
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${e(storeName)} 食譜</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:14px/1.6 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#222;margin:24px}h1{font-size:24px;margin:0 0 8px}h2{font-size:16px;margin:16px 0 6px}p{margin:6px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:7px;border-bottom:1px solid #bbb;text-align:left;overflow-wrap:anywhere}th{background:#f0f0f0}td.num,th.num{text-align:right}small{font-size:11px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}section{margin-bottom:32px}.muted{color:#555}.print-button{padding:10px 20px;margin-bottom:20px}@media print{body{margin:0}.print-button{display:none}section+section{break-before:page}tr{break-inside:avoid}thead{display:table-header-group}h1,h2{break-after:avoid}}</style></head><body><button class="print-button" id="print-recipe">列印／另存 PDF</button>${sections}<p class="muted"><small>附屬配方列出完整製作量供查閱，不再重複加入主食譜總成本。${includeCost?'金額為匯出當下採用的成本；缺項不以零元代替。':''}</small></p></body></html>`;
}
export function openRecipePrint(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const popup=window.open('','_blank');if(!popup)throw Error('瀏覽器阻擋了列印視窗，請允許此網站開啟彈出視窗後再試。');
 popup.opener=null;popup.document.open();popup.document.write(recipePrintHtml(storeName,workspace,ids,includeCost));popup.document.close();
 const button=popup.document.getElementById('print-recipe');if(button)button.onclick=()=>popup.print();popup.focus();
}
export type RecipeWorkbookSheet={name:string;rows:(string|number|null)[][];widths:number[];filter?:boolean};
export function recipeWorkbookData(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean):RecipeWorkbookSheet[]{
 const entries=recipeExportEntries(workspace,ids);
 const summaryRows:(string|number|null)[][]=[['門市','食譜名稱','類型','製成量','單位','歸屬主食譜',...(includeCost?['成本金額（元）','成本依據','每單位成本','單份使用成本','已知明細小計','成本狀態']:[])]];
 for(const entry of entries){const {card}=entry,doc=card.document,s=exportSummary(entry);summaryRows.push([storeName,recipeDisplayName(doc),doc.kind==='dish'?'主食譜':'附屬配方',doc.yield?Number(doc.yield):'待填',doc.unit,entry.parents.join('、'),...(includeCost?[s.reference.amount??'待補齊',s.reference.label,s.unit??'待補齊',s.portion??'未設定',card.cost.lines.some(line=>line.amount!==null)?s.subtotal:'待補齊',s.status]:[])]);}
 const sheets:RecipeWorkbookSheet[]=[{name:'食譜總覽',rows:summaryRows,widths:[12,32,12,12,10,30,18,24,18,18,18,50].slice(0,summaryRows[0].length),filter:true}];
 entries.forEach((entry,index)=>{
  const {card}=entry,doc=card.document,cost=card.cost,s=exportSummary(entry);
  const rows:(string|number|null)[][]=[[storeName,recipeDisplayName(doc)],[doc.kind==='dish'?'主食譜':'附屬配方','製成量',doc.yield?Number(doc.yield):'待填',doc.unit],['歸屬主食譜',entry.parents.join('、')],[],['食材編碼','食材／配件','實際用量','單位',...(includeCost?['單位成本','使用成本','價格來源','價格日期','供應商','狀態']:[]),'備註']];
  doc.lines.forEach(line=>{const result=cost.lines.find(row=>row.id===line.id);rows.push([recipeIngredientCode(line,workspace),line.name,line.quantity?Number(line.quantity):'待填',line.unit,...(includeCost?[exportLineUnitCost(card,line)??'待補齊',result?.amount??'待補齊',result?.price?.source||(line.recipe_id?'附屬配方':''),result?.price?.effective_date||'未記載',result?.price?.supplier_name||result?.price?.source_ref?.supplier_name||'',result?.reason||'']:[]),recipeNoteText(line,doc.notes)]);});
  if(includeCost){
   if(!s.reference.locked&&s.reference.amount!==null)rows.push([],[s.reference.label,s.reference.amount]);
   rows.push([],['整份配方成本',s.total??'待補齊'],['已知明細小計',cost.lines.some(line=>line.amount!==null)?s.subtotal:'待補齊'],['每單位成本',s.unit??'待補齊'],['狀態',s.status]);
  }
  rows.push([],['作法與備註',doc.notes],[],['來源食譜',doc.source_name||''],['提醒','附屬配方列出製作量供查閱，不再重複加入主食譜成本。']);
  const name=`${index+1}-${recipeDisplayName(doc)}`.replace(/[\\/?*\[\]:]/g,' ').slice(0,31);
  sheets.push({name,rows,widths:[16,26,20,12,...(includeCost?[18,18,36,16,22,28]:[]),50]});
 });
 return sheets;
}
export async function createRecipeWorkbook(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const XLSX=await import('xlsx'),book=XLSX.utils.book_new();
 for(const data of recipeWorkbookData(storeName,workspace,ids,includeCost)){
  const sheet=XLSX.utils.aoa_to_sheet(data.rows);sheet['!cols']=data.widths.map(wch=>({wch}));
  if(data.filter)sheet['!autofilter']={ref:sheet['!ref']!};
  for(const address of Object.keys(sheet)){if(address.startsWith('!'))continue;const cell=sheet[address];if(cell.t==='n')cell.z='0.00##';}
  XLSX.utils.book_append_sheet(book,sheet,data.name);
 }
 return book;
}
export async function exportRecipeWorkbook(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const XLSX=await import('xlsx'),book=await createRecipeWorkbook(storeName,workspace,ids,includeCost);
 const filename=`${storeName}-食譜-${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}.xlsx`.replace(/[\\/:*?"<>|]/g,'-');
 XLSX.writeFile(book,filename,{compression:true});
}
