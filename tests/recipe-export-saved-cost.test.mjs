import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import CFB from 'cfb';
import {emptyRecipe} from '../lib/recipe-cost.ts';
import {recipeExportEntries,exportSummary,exportLineUnitCost,recipeWorkbookData,createRecipeWorkbook,createRecipeWorkbookBytes,recipePrintHtml} from '../lib/recipe-export.ts';

const line=(id,name,quantity='2')=>({id,name,quantity,unit:'g'});
const quote={key:'n:食材',name:'食材',unit:'g',price:10,source:'已保存進貨',effective_date:'2026-10-15',product_id:null,source_ref:{supplier_name:'原供應商'}};
const card=(id,lines,cost,extra={})=>({id,revision:3,recipe_code:`R-${id}`,updated_at:'2026-11-20',cost_loaded:true,document:{...emptyRecipe(),name:id,yield:'1',lines,...extra},cost});
const workspace=recipes=>({recipes,products:[],prices:[],pricing_loaded:false,can_price:false});
test('saved-only export keeps known whole costs and matches line amounts/prices by ID, not row order',()=>{
 const a=line('a','食材甲','2'),b=line('b','食材乙','3');
 const saved={total:460.863,subtotal:460.863,missing:0,lines:[{id:'b',amount:300,price:quote,reason:null},{id:'a',amount:160.863,price:quote,reason:null}]};
 const root=card('威靈頓牛排',[a,b],saved),ws=workspace([root]),before=JSON.stringify(ws);
 const entry=recipeExportEntries(ws,[root.id])[0];
 assert.deepEqual(entry.card.cost,saved);assert.equal(exportSummary(entry).total,460.863);
 assert.equal(exportLineUnitCost(entry.card,a),80.4315);assert.equal(exportLineUnitCost(entry.card,b),100);
 const detail=recipeWorkbookData('BeApe',ws,[root.id],true)[1];
 assert.equal(detail.rows[5][5],160.863);assert.equal(detail.rows[6][5],300);
 assert.equal(detail.rows[5][6],'已保存進貨');assert.equal(detail.rows[5][8],'原供應商');
 assert.equal(JSON.stringify(ws),before);
});
test('partial snapshots retain original portion references and known subtotals without filling missing lines from another catalog',()=>{
 const saved={total:null,subtotal:80,missing:1,lines:[{id:'a',amount:80,price:quote,reason:null},{id:'b',amount:null,price:null,reason:'待補用量'}]};
 const root=card('蟹肉蛋',[line('a','食材'),line('b','缺料','')],saved,{source_cost_per_portion:123.04});
 const ws={...workspace([root]),prices:[{...quote,price:999}]};
 const [summary,detail]=recipeWorkbookData('BeApe',ws,[root.id],true);
 assert.equal(summary.rows[1][7],123.04);assert.match(summary.rows[1][10],/原食譜每份成本/);
 assert.match(summary.rows[1][10],/已知明細小計：80/);assert.match(summary.rows[1][10],/待補齊/);
 assert.equal(detail.rows[6][5],'待補齊');
 assert.equal(recipeExportEntries(ws,[root.id])[0].card.cost.total,null);
 assert.match(recipePrintHtml('BeApe',ws,[root.id],true),/原食譜每份成本：NT\$ 123.04/);
});
test('unknown serving quantities expose a saved purchase price without inventing a whole serving cost',()=>{
 const ingredient={...line('a','生蠔',''),unit:'顆',ingredient_id:'i'};
 const saved={total:null,subtotal:0,missing:1,lines:[{id:'a',amount:null,price:{...quote,unit:'顆',price:145},reason:'待補用量'}]};
 const root=card('生蠔盤',[ingredient],saved),ws=workspace([root]);
 assert.equal(exportLineUnitCost(root,ingredient),145);
 const data=recipeWorkbookData('BeApe',ws,[root.id],true);
 assert.equal(data[0].rows[1][7],145);assert.match(data[0].rows[1][10],/進貨單價／顆/);
 assert.equal(data[1].rows[5][4],145);assert.equal(data[1].rows[5][5],'待補齊');
});
test('pending component memberships preserve a saved total and shared components still export once',()=>{
 const saved={total:100,subtotal:100,missing:0,lines:[{id:'a',amount:100,price:quote,reason:null}]};
 const prep=card('配件',[line('p','配件食材')],{...saved,lines:[{id:'p',amount:100,price:quote,reason:null}]},{kind:'prep'});
 const root=card('主食譜',[line('a','食材')],saved,{component_order:['配件']});
 const entries=recipeExportEntries(workspace([root,{...root,id:'other'},prep]),['主食譜','other']);
 assert.equal(entries.filter(entry=>entry.card.id==='配件').length,1);
 assert.equal(exportSummary(entries[0]).total,100);assert.equal(exportSummary(entries[0]).unit,100);
 assert.match(exportSummary(entries[0]).status,/配件用量／版本待確認/);
});
test('encoded Excel keeps saved amounts as numeric cells and kitchen copies omit cost columns',async()=>{
 const saved={total:0,subtotal:0,missing:0,lines:[{id:'a',amount:0,price:{...quote,price:0},reason:null}]};
 const root=card('零元已知',[line('a','免費食材')],saved),ws=workspace([root]);
 const book=await createRecipeWorkbook('BeApe',ws,[root.id],true);
 const read=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 assert.equal(read.Sheets['食譜總覽'].H2.t,'n');assert.equal(read.Sheets['食譜總覽'].H2.v,0);
 assert.equal(read.Sheets[read.SheetNames[1]].F6.t,'n');assert.equal(read.Sheets[read.SheetNames[1]].F6.v,0);
 const kitchen=await createRecipeWorkbook('BeApe',ws,[root.id],false);
 const rows=XLSX.utils.sheet_to_json(kitchen.Sheets['食譜總覽'],{header:1});
 assert.equal(rows[0].length,7);assert.equal(JSON.stringify(rows).includes('成本'),false);
});

test('template export separates exact POS names, retains numeric saved costs, and encodes template styling without changing source data',async()=>{
 const root=card('r',[line('a','食材')],{total:123.456,subtotal:123.456,missing:0,lines:[{id:'a',amount:123.456,price:quote,reason:null}]});
 const other=card('unmatched',[],{total:0,subtotal:0,missing:0,lines:[]}),ws=workspace([root,other]),before=JSON.stringify(ws);
 const mapping={r:'POS 中英文名稱 Bread & Butter'};
 const bytes=await createRecipeWorkbookBytes('BeApe',ws,['r','unmatched'],true,mapping);
 const read=XLSX.read(bytes,{type:'array',cellStyles:true}),sheet=read.Sheets['食譜總覽'];
 const rows=XLSX.utils.sheet_to_json(sheet,{header:1});
 assert.deepEqual(rows[0],['門市','POS 名稱','食譜名稱','類型','製成量','單位','歸屬主食譜','整份配方成本','每單位成本','單份使用成本','狀態']);
 assert.equal(sheet.B2.v,mapping.r);assert.equal(sheet.C2.v,'r');assert.equal(sheet.H2.v,123.456);assert.equal(sheet.H3.v,0);
 assert.equal(sheet.B3?.v||'','');assert.equal(sheet['!autofilter'],undefined);
 assert.ok([8,9,10].every(index=>sheet['!cols'][index].hidden));
 assert.equal(read.SheetNames.length,3);assert.equal(JSON.stringify(ws),before);
 const zip=CFB.read(bytes,{type:'buffer'}),xml=path=>new TextDecoder().decode(CFB.find(zip,`/${path}`).content);
 assert.match(xml('xl/styles.xml'),/<sz val="12"\/><name val="新細明體"\/>/);
 assert.match(xml('xl/styles.xml'),/fgColor rgb="FFFFFF00"/);
 assert.match(xml('xl/worksheets/sheet1.xml'),/<row[^>]*r="2"[^>]*ht="30"/);
 assert.equal(sheet.B2.s.fgColor.rgb,'FFFF00');assert.equal(sheet.C2.s.fgColor.rgb,'FFFF00');
 assert.equal(sheet.C3.s.patternType,'none');
 assert.equal(read.Sheets[read.SheetNames[1]].F6.v,123.456);
});
