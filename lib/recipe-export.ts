import {recipeComponents,recipeCost,recipeDisplayName,recipeNoteText,recipePortionCost,type RecipeCard,type RecipeWorkspace} from './recipe-cost.ts';
export type RecipeExportEntry={card:RecipeCard;parents:string[];pendingComponents:string[]};
export function recipeExportEntries(workspace:RecipeWorkspace,ids:string[]):RecipeExportEntry[]{
 const selected=new Set(ids),entries=new Map<string,RecipeExportEntry>();
 function add(card:RecipeCard,parent?:string){const old=entries.get(card.id);if(old){if(parent&&!old.parents.includes(parent))old.parents.push(parent);return;}entries.set(card.id,{card:{...card,cost:recipeCost(card.document,workspace,[card.id])},parents:parent?[parent]:[],pendingComponents:[]});}
 for(const root of workspace.recipes.filter(card=>selected.has(card.id))){add(root);const title=recipeDisplayName(root.document),components=recipeComponents(root,workspace);entries.get(root.id)!.pendingComponents=components.filter(c=>!c.recipe||!c.uses.length).map(c=>c.name);for(const component of components){if(component.recipe)add(component.recipe,title);else for(const candidate of component.candidates)add(candidate,`${title}（版本待確認）`);}}
 return [...entries.values()];
}
export function exportSummary(entry:RecipeExportEntry){
 const {card,pendingComponents}=entry,doc=card.document,cost=card.cost,complete=cost.total!==null&&!pendingComponents.length;
 const yieldQty=Number(doc.yield),unit=yieldQty>0&&Number.isFinite(yieldQty)&&cost.total!==null?cost.total/yieldQty:null;
 return {complete,total:complete?cost.total:null,subtotal:cost.subtotal,unit:complete?unit:null,portion:complete?recipePortionCost(doc,cost):null,status:complete?'完整':`待補齊${cost.missing?`：${cost.missing} 項價格或用量`:''}${pendingComponents.length?`；配件用量／版本：${pendingComponents.join('、')}`:''}`};
}
const numberText=(n:number|null,digits=2)=>n===null?'待補齊':n.toLocaleString('zh-TW',{maximumFractionDigits:digits,minimumFractionDigits:digits});
export function escapeRecipeHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export function recipePrintHtml(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const e=escapeRecipeHtml,entries=recipeExportEntries(workspace,ids);
 const sections=entries.map(entry=>{
  const {card}=entry,doc=card.document,summary=exportSummary(entry),cost=card.cost;
  const units=recipeCost({...doc,lines:doc.lines.map(line=>({...line,quantity:'1'}))},workspace,[card.id]);
  const rows=doc.lines.map((line,i)=>`<tr><td>${e(line.name)}</td><td class="num">${e(line.quantity||'待填')} ${e(line.unit)}</td>${includeCost?`<td class="num">${e(numberText(units.lines[i]?.amount??null,4))}<br><small>元／${e(line.unit)}</small></td><td class="num">${e(numberText(cost.lines[i]?.amount??null))}</td>`:''}<td>${e(recipeNoteText(line,doc.notes))}</td></tr>`).join('');
  const totals=includeCost?`<p>整份配方成本：NT$ ${e(numberText(summary.total))} · 每 ${e(doc.unit)}：NT$ ${e(numberText(summary.unit))}</p><p class="muted">${e(summary.status)}${!summary.complete?`；已計入成本 NT$ ${e(numberText(summary.subtotal))}（不是完整總成本）`:''}</p>`:'';
  return `<section><p class="muted">${e(storeName)} · ${doc.kind==='dish'?'主食譜':'附屬配方'}${entry.parents.length?` · 用於 ${e(entry.parents.join('、'))}`:''}</p><h1>${e(recipeDisplayName(doc))}</h1><p>製成量：${e(doc.yield||'待填')} ${e(doc.unit)}</p><table><thead><tr><th>食材／配件</th><th class="num">實際用量</th>${includeCost?'<th class="num">單位成本</th><th class="num">使用成本</th>':''}<th>備註</th></tr></thead><tbody>${rows}</tbody></table>${totals}<h2>作法與備註</h2><pre>${e(doc.notes||'未填寫')}</pre></section>`;
 }).join('');
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${e(storeName)} 食譜</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:14px/1.6 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#222;margin:24px}h1{font-size:24px;margin:0 0 8px}h2{font-size:16px;margin:16px 0 6px}p{margin:6px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:7px;border-bottom:1px solid #bbb;text-align:left;overflow-wrap:anywhere}th{background:#f0f0f0}td.num,th.num{text-align:right}small{font-size:11px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}section{margin-bottom:32px}.muted{color:#555}.print-button{padding:10px 20px;margin-bottom:20px}@media print{body{margin:0}.print-button{display:none}section+section{break-before:page}tr{break-inside:avoid}thead{display:table-header-group}h1,h2{break-after:avoid}}</style></head><body><button class="print-button" id="print-recipe">列印／另存 PDF</button>${sections}<p class="muted"><small>附屬配方列出完整製作量供查閱，不再重複加入主食譜總成本。${includeCost?'金額為匯出當下採用的成本；缺項不以零元代替。':''}</small></p></body></html>`;
}
export function openRecipePrint(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const popup=window.open('','_blank');if(!popup)throw Error('瀏覽器阻擋了列印視窗，請允許此網站開啟彈出視窗後再試。');
 popup.opener=null;popup.document.open();popup.document.write(recipePrintHtml(storeName,workspace,ids,includeCost));popup.document.close();
 const button=popup.document.getElementById('print-recipe');if(button)button.onclick=()=>popup.print();popup.focus();
}
export async function exportRecipeWorkbook(storeName:string,workspace:RecipeWorkspace,ids:string[],includeCost:boolean){
 const XLSX=await import('xlsx'),entries=recipeExportEntries(workspace,ids),book=XLSX.utils.book_new();
 const summaryRows:(string|number|null)[][]=[['門市','食譜名稱','類型','製成量','單位','歸屬主食譜',...(includeCost?['整份配方成本','每單位成本','單份使用成本','狀態']:[])]];
 for(const entry of entries){const {card}=entry,doc=card.document,s=exportSummary(entry);summaryRows.push([storeName,recipeDisplayName(doc),doc.kind==='dish'?'主食譜':'附屬配方',doc.yield?Number(doc.yield):'待填',doc.unit,entry.parents.join('、'),...(includeCost?[s.total??'待補齊',s.unit??'待補齊',s.portion??'未設定',s.status]:[])]);}
 const summary=XLSX.utils.aoa_to_sheet(summaryRows);summary['!cols']=[12,28,12,12,10,30,18,18,18,50].slice(0,summaryRows[0].length).map(wch=>({wch}));summary['!autofilter']={ref:summary['!ref']!};XLSX.utils.book_append_sheet(book,summary,'食譜總覽');
 entries.forEach((entry,index)=>{
  const {card}=entry,doc=card.document,cost=card.cost,s=exportSummary(entry),units=recipeCost({...doc,lines:doc.lines.map(line=>({...line,quantity:'1'}))},workspace,[card.id]);
  const rows:(string|number|null)[][]=[[storeName,recipeDisplayName(doc)],[doc.kind==='dish'?'主食譜':'附屬配方','製成量',doc.yield?Number(doc.yield):'待填',doc.unit],['歸屬主食譜',entry.parents.join('、')],[],['食材／配件','實際用量','單位',...(includeCost?['單位成本','使用成本','價格來源','價格日期','供應商','狀態']:[]),'備註']];
  doc.lines.forEach((line,i)=>{const result=cost.lines[i];rows.push([line.name,line.quantity?Number(line.quantity):'待填',line.unit,...(includeCost?[units.lines[i]?.amount??'待補齊',result?.amount??'待補齊',result?.price?.source||(line.recipe_id?'附屬配方':''),result?.price?.effective_date||'未記載',result?.price?.supplier_name||result?.price?.source_ref?.supplier_name||'',result?.reason||'']:[]),recipeNoteText(line,doc.notes)]);});
  if(includeCost)rows.push([],['整份配方成本',s.total??'待補齊'],['已計入成本（非完整總成本）',s.subtotal],['每單位成本',s.unit??'待補齊'],['狀態',s.status]);
  rows.push([],['作法與備註',doc.notes],[],['來源食譜',doc.source_name||''],['提醒','附屬配方列出製作量供查閱，不再重複加入主食譜成本。']);
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=[26,20,12,...(includeCost?[18,18,36,16,22,28]:[]),50].map(wch=>({wch}));
  for(const address of Object.keys(sheet)){if(address.startsWith('!'))continue;const cell=sheet[address];if(cell.t==='n')cell.z='0.00##';}
  const name=`${index+1}-${recipeDisplayName(doc)}`.replace(/[\\/?*\[\]:]/g,' ').slice(0,31);XLSX.utils.book_append_sheet(book,sheet,name);
 });
 const filename=`${storeName}-食譜-${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}.xlsx`.replace(/[\\/:*?"<>|]/g,'-');
 XLSX.writeFile(book,filename,{compression:true});
}
