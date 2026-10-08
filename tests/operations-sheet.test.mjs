import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
import * as specification from '../lib/purchase-specification.ts';
import * as helpers from '../lib/operations-sheet.ts';
import * as draftHelpers from '../lib/operations-sheet-draft.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../app/pilot/operations-sheet.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source.slice(source.indexOf('export default function')).replace('export default ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const columns=[{key:'name',label:'品名',required:true},{key:'quantity',label:'數量',type:'number'},{key:'price',label:'單價',type:'number'},{key:'amount',label:'金額',readonly:true}];
const row=(id,quantity='2')=>({id,state:'LIVE',values:{name:id,quantity,price:'5',amount:String(Number(quantity)*5)}});
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
function harness(options={}){const hooks=[],calls=[],exports=[],confirms=[],microtasks=[];const storage=options.storage||new Map();const draftStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(options.storageFails)throw Error('QUOTA');storage.set(key,value);},removeItem:key=>storage.delete(key)};let cursor=0,effects=[],changed=false,tree,id=0,failed='',refreshes=0,refreshFails=false,confirmAnswer=true;const persisted=[row('a'),row('b')];
 const props={cloudDraft:options.cloudDraft,userId:options.userId||'u1',title:'測試',scope:options.scope||'test',rows:[...persisted],columns,defaults:{name:'',quantity:'',price:''},month:options.month||'2026-10',loading:false,error:'',onMonth(){},onSave:async r=>{calls.push(r);if(r.id===failed)throw Error('NETWORK');const index=persisted.findIndex(p=>p.id===r.id);if(index>=0)persisted[index]={...r,fresh:false};else persisted.push({...r,fresh:false});},onRefresh:async()=>{refreshes++;if(refreshFails){props.error='讀取失敗';throw Error('REFRESH_FAILED');}props.error='';props.rows=[...persisted];},onRemove:async()=>{},registerLeave(fn){props.leave=fn;}};
 const scope={React,require,queueMicrotask:fn=>microtasks.push(fn),...helpers,...specification,...draftHelpers,workspaceStorage:()=>draftStorage,crypto:{randomUUID:()=>`new-${++id}`},window:{confirm:message=>{confirms.push(message);return confirmAnswer;},addEventListener(){},removeEventListener(){}},exportRows:async(...args)=>exports.push(args),useState:initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:initial,set(v){const next=typeof v==='function'?v(hooks[i].value):v;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;changed=true;}}};return [hooks[i].value,hooks[i].set];},useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},useCallback:(fn,deps)=>{const i=cursor++;if(!same(hooks[i]?.deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},useEffect:(fn,deps)=>{const i=cursor++;if(!same(hooks[i]?.deps,deps))effects.push(()=>{hooks[i]?.cleanup?.();hooks[i]={deps,cleanup:fn()};});}};
 runInNewContext(compiled,scope);
 function render(){let count=0;do{changed=false;cursor=0;effects=[];tree=scope.OperationsSheet(props);effects.forEach(fn=>fn());while(microtasks.length)microtasks.shift()();if(++count>30)throw Error('render loop');}while(changed);return tree;}
 const field=label=>nodes(render()).find(n=>n.props?.['aria-label']===label);
 const button=label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label);
 render();return {props,calls,exports,storage,confirms,field,button,render,failRefresh:value=>refreshFails=value,confirm:value=>confirmAnswer=value,refreshes:()=>refreshes,fail:id=>failed=id,text:()=>text(render()),click(label){const b=button(label);assert.ok(b,`button ${label}`);if(!b.props.disabled)b.props.onClick();render();},edit(label,value){field(label).props.onChange({target:{value}});render();},async settle(){for(let i=0;i<35;i++){await Promise.resolve();render();}},import(files){nodes(render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files}});render();}};
}
test('partial save preserves unsaved input and retries only remaining rows with the same request',async()=>{const h=harness();h.click('編輯全部');h.edit('a 數量','3');h.edit('b 數量','4');assert.equal(h.calls.length,0);h.fail('b');h.click('儲存變更');await h.settle();assert.deepEqual(h.calls.map(r=>r.id),['a','b']);assert.equal(h.props.rows[0].values.quantity,'3');assert.equal(h.field('b 數量').props.value,'4');const request=h.calls[1].requestId;h.fail('');h.click('儲存變更');await h.settle();assert.deepEqual(h.calls.map(r=>r.id),['a','b','b']);assert.equal(h.calls[2].requestId,request);assert.match(h.text(),/已儲存 1 筆/);});
test('new row stays inline and does not persist until save; cancel leaves database alone',()=>{const h=harness();h.click('新增');assert.ok(h.field('新增 品名'));assert.equal(nodes(h.render()).filter(n=>n.type==='table').length,1);assert.equal(h.calls.length,0);h.click('取消編輯');assert.equal(h.calls.length,0);assert.equal(h.field('新增 品名'),undefined);});
test('read-only or load failure blocks stale edits and writes',async()=>{const h=harness();h.click('編輯全部');h.edit('a 數量','3');h.props.readOnly=true;h.click('儲存變更');await h.settle();assert.equal(h.calls.length,0);assert.equal(h.field('a 數量'),undefined);});
test('IME composition blocks save until committed',async()=>{const h=harness();h.click('編輯全部');h.edit('a 數量','3');h.field('a 數量').props.onCompositionStart();h.click('儲存變更');await h.settle();assert.equal(h.calls.length,0);h.field('a 數量').props.onCompositionEnd();h.click('儲存變更');await h.settle();assert.equal(h.calls.length,1);});
test('multi-file import previews within the table, deduplicates and requires explicit save',async()=>{const h=harness();const XLSX=require('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'品名':'新食材','數量':'3','單價':'20'}]),'資料');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});const file={name:'import.xlsx',arrayBuffer:async()=>bytes};h.import([file,file]);await h.settle();assert.equal(h.calls.length,0);assert.match(h.text(),/匯入預覽 1 筆，略過 1 筆/);assert.equal(h.field('新食材 數量').props.value,'3');h.click('儲存變更');await h.settle();assert.equal(h.calls.length,1);});
test('import normalizes numbers/dates, ignores protected columns and rejects removed identities',()=>{let id=0;const cols=[...columns,{key:'date',label:'日期',type:'date'},{key:'unit',label:'單位',editable:r=>r.fresh}];const original={...row('a'),values:{...row('a').values,date:'2026-10-01',unit:'包'}};const r=helpers.sheetImports([{'資料編號':'a','品名':'a','數量':'1,000','日期':'2026/10/2','單位':'瓶','金額':'999'}],cols,[original],{},()=>String(++id));assert.equal(r.rows[0].values.quantity,'1000');assert.equal(r.rows[0].values.date,'2026-10-02');assert.equal(r.rows[0].values.unit,'包');assert.equal(r.rows[0].values.amount,'5000');assert.throws(()=>helpers.sheetImports([{'資料編號':'a'}],cols,[{...original,state:'REMOVED'}],{},()=>''),/已移除/);assert.throws(()=>helpers.sheetImports([{'資料編號':'foreign-store'}],cols,[original],{},()=>''),/資料編號/);});
test('receipt merge retains another row’s header update and rejects same-field conflicts',()=>{const base={supplier:'舊供應商',name:'a',quantity:'2'};assert.deepEqual(helpers.sheetMerge(base,{...base,quantity:'3'},{...base,supplier:'新供應商'},Object.keys(base)),{supplier:'新供應商',name:'a',quantity:'3'});assert.throws(()=>helpers.sheetMerge(base,{...base,quantity:'3'},{...base,quantity:'4'},Object.keys(base)),/REVISION_CONFLICT/);});
test('export chooses selected persisted rows and retains roundtrip identity',async()=>{const h=harness();h.field('選取 a').props.onChange({target:{checked:true}});h.click('匯出');await h.settle();assert.equal(h.exports[0][0].length,1);assert.equal(h.exports[0][0][0]['資料編號'],'a');});
test('failed refresh after partial save has a non-destructive retry path',async()=>{
 const h=harness();h.click('編輯全部');h.edit('a 數量','3');h.edit('b 數量','4');h.fail('b');h.failRefresh(true);h.click('儲存變更');await h.settle();
 assert.equal(h.props.error,'讀取失敗');assert.equal(h.field('b 數量').props.value,'4');assert.equal(h.button('保留輸入並重試讀取').props.disabled,false);assert.equal(h.button('儲存變更').props.disabled,true);
 const request=h.calls[1].requestId;h.failRefresh(false);h.click('保留輸入並重試讀取');await h.settle();assert.equal(h.props.rows[0].values.quantity,'3');assert.equal(h.field('b 數量').props.value,'4');h.fail('');h.click('儲存變更');await h.settle();assert.deepEqual(h.calls.map(r=>r.id),['a','b','b']);assert.equal(h.calls[2].requestId,request);assert.equal(h.storage.size,0);
});
test('draft survives remount with its retry token and is only committed after explicit restore and save',async()=>{
 const h=harness();h.click('編輯全部');h.edit('a 數量','7');assert.equal(h.calls.length,0);const key=draftHelpers.sheetDraftKey('u1','test','2026-10');const saved=JSON.parse(h.storage.get(key));assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].values.quantity,'7');
 const restored=harness({storage:h.storage});assert.ok(restored.button('恢復草稿'));assert.equal(restored.button('新增').props.disabled,true);assert.equal(restored.calls.length,0);restored.click('恢復草稿');assert.equal(restored.field('a 數量').props.value,'7');assert.equal(restored.calls.length,0);restored.click('儲存變更');await restored.settle();assert.equal(restored.calls[0].requestId,saved.rows[0].requestId);assert.equal(restored.storage.size,0);
});
test('drafts are isolated by account, store/module scope and month',()=>{
 const h=harness();h.click('編輯全部');h.edit('a 數量','7');const before=[...h.storage];for(const options of [{userId:'u2'},{scope:'other-store'},{scope:'waste'},{month:'2026-09'}]){const other=harness({...options,storage:h.storage});assert.equal(other.button('恢復草稿'),undefined);}assert.deepEqual([...h.storage],before);
});
test('discarding a recovered draft requires confirmation and never writes to the server',()=>{
 const h=harness();h.click('新增');h.edit('新增 品名','新食材');const restored=harness({storage:h.storage});restored.confirm(false);restored.click('捨棄草稿');assert.ok(restored.button('恢復草稿'));restored.confirm(true);restored.click('捨棄草稿');assert.equal(restored.button('恢復草稿'),undefined);assert.equal(restored.calls.length,0);assert.equal(h.storage.size,0);
});
test('storage failure is visible and never discards the in-memory input',()=>{
 const h=harness({storageFails:true});h.click('編輯全部');h.edit('a 數量','9');assert.equal(h.field('a 數量').props.value,'9');assert.match(h.text(),/無法暫存草稿/);assert.doesNotMatch(h.text(),/草稿已暫存/);assert.equal(h.storage.size,0);
});
test('a stale second tab does not replace an already newer local draft',()=>{
 const storage=new Map();const first=harness({storage}),second=harness({storage});first.click('編輯全部');second.click('編輯全部');first.edit('a 數量','6');const snapshot=[...storage];second.edit('a 數量','8');assert.deepEqual([...storage],snapshot);assert.equal(second.field('a 數量').props.value,'8');assert.match(second.text(),/另一個分頁已更新草稿/);
});
test('export warns about drafts and uses only persisted values, excluding newly added rows',async()=>{
 const h=harness();h.click('編輯全部');h.edit('a 數量','9');h.click('新增');h.edit('新增 品名','新食材');h.confirm(false);h.click('匯出');await h.settle();assert.equal(h.exports.length,0);h.confirm(true);h.click('匯出');await h.settle();const exported=h.exports[0][0];assert.equal(exported.length,2);assert.equal(exported.find(r=>r['資料編號']==='a')['數量'],'2');assert.equal(exported.find(r=>r['資料編號']==='a')['金額'],'10');assert.ok(h.confirms.some(m=>m.includes('只匯出已儲存版本')));assert.equal(h.calls.length,0);
});
test('selecting only fresh rows cannot silently export an empty or unrelated workbook',async()=>{
 const h=harness();h.click('新增');h.edit('新增 品名','新食材');h.field('選取 新食材').props.onChange({target:{checked:true}});h.click('匯出');await h.settle();assert.equal(h.exports.length,0);assert.match(h.text(),/新增列請先儲存/);
});
test('refresh that removes an edited row keeps its draft visible without writing it back',async()=>{
 const h=harness();h.click('編輯全部');h.edit('b 數量','8');h.props.rows=[row('a')];assert.match(h.text(),/b/);assert.equal(h.field('b 數量'),undefined);h.click('儲存變更');await h.settle();assert.equal(h.calls.length,0);assert.match(h.text(),/不在此月份，草稿保留/);const snapshot=JSON.parse([...h.storage.values()][0]);assert.equal(snapshot.rows[0].values.quantity,'8');
});
test('export is unavailable while the server snapshot is unconfirmed after a load error',async()=>{
 const h=harness();h.props.error='讀取失敗';h.click('匯出');await h.settle();assert.equal(h.exports.length,0);assert.equal(h.button('重新讀取').props.disabled,false);
});

test('price lookup previews in place, targets missing rows, and requires save',async()=>{const h=harness();h.props.rows[0]={...h.props.rows[0],values:{...h.props.rows[0].values,price:'',amount:''}};const requests=[];h.props.onPrice=async rows=>{requests.push(rows.map(r=>r.id));return rows.map(r=>({...r,requestId:'quote-retry',values:{...r.values,price:'12',amount:'24',price_source:'請購表'}}));};h.click('帶入進價');await h.settle();assert.deepEqual(JSON.parse(JSON.stringify(requests)),[['a']]);assert.equal(h.calls.length,0);assert.equal(h.field('a 單價').props.value,'12');assert.equal(h.field('b 單價').props.value,'5');h.click('儲存變更');await h.settle();assert.equal(h.calls[0].requestId,'quote-retry');});
test('replacing selected prices requires confirmation and lookup failure keeps input',async()=>{const h=harness();h.props.onPrice=async()=>{throw Error('價格服務逾時');};h.field('選取 a').props.onChange({target:{checked:true}});h.confirm(false);h.click('帶入進價');await h.settle();assert.equal(h.calls.length,0);h.confirm(true);h.click('帶入進價');await h.settle();assert.match(h.text(),/價格查找失敗/);assert.equal(h.props.rows[0].values.price,'5');});

test('cloud draft is explicit, independent of formal save, and remains on a conflict',async()=>{
 let token=null;const writes=[];
 const cloudDraft={read:async()=>null,save:async(rows,expected,next)=>{if(expected!==token)throw Error('DRAFT_CHANGED');token=next;writes.push(rows);return {version:1,token:next,updatedAt:'2026-10-08',rows};}};
 const h=harness({cloudDraft});await h.settle();h.click('編輯全部');h.edit('a 數量','9');h.click('保存草稿');await h.settle();assert.equal(writes.length,1);assert.equal(writes[0][0].values.quantity,'9');assert.equal(h.calls.length,0);assert.match(h.text(),/草稿已保存至系統/);
 token='another-device';h.edit('a 數量','10');h.click('保存草稿');await h.settle();assert.equal(h.field('a 數量').props.value,'10');assert.match(h.text(),/其他裝置已修改草稿/);assert.equal(h.calls.length,0);
});
test('remote draft is recovered with its original request identity on another device',async()=>{
 const draft={...row('a','8'),requestId:'saved-request'};
 const h=harness({cloudDraft:{read:async()=>({version:1,token:'remote',updatedAt:'2026-10-08',rows:[draft]}),save:async(rows,expected,token)=>({version:1,token,updatedAt:'2026-10-08',rows})}});
 await h.settle();assert.ok(h.button('恢復草稿'));h.click('恢復草稿');assert.equal(h.field('a 數量').props.value,'8');h.click('儲存變更');await h.settle();assert.equal(h.calls[0].requestId,'saved-request');
});
test('inventory zone filter includes multi-zone rows and exports the same persisted scope',async()=>{
 const h=harness({scope:'inventory-store'});h.props.rows=[{...row('a'),values:{...row('a').values,zone:'冷藏庫、乾貨區'}},{...row('b'),values:{...row('b').values,zone:'冷凍庫'}}];
 h.edit('篩選儲物區','乾貨區');assert.ok(h.field('選取 a'));assert.equal(h.field('選取 b'),undefined);
 h.click('匯出');await h.settle();assert.deepEqual(Array.from(h.exports[0][0],r=>r['資料編號']),['a']);
});
test('price-basis-only changes remain savable even when specification is displayed in one column',()=>{
 const values={name:'奶油',price:'250',purchase_price:'250',price_unit:'瓶',content_quantity:'1',content_unit:'公升',purchase_specification:'1公升'};
 assert.notEqual(helpers.sheetFingerprint(values,columns),helpers.sheetFingerprint({...values,content_quantity:'2',purchase_specification:'2公升'},columns));
});

test('inline pricing specification changes recalculate the amount and export a recoverable package basis',async()=>{
 const h=harness({scope:'waste-store'});
 h.props.columns=[{key:'name',label:'品名'},{key:'quantity',label:'數量',type:'number'},{key:'unit',label:'單位'},{key:'purchase_price',label:'進價',type:'number'},{key:'price_unit',label:'計價規格',pricingBasis:true,options:['瓶','公斤']},{key:'amount',label:'金額',readonly:true}];
 h.props.rows=[{id:'a',state:'LIVE',values:{name:'酒',quantity:'150',unit:'ml',price:'.12',amount:'18',purchase_price:'90',price_unit:'瓶',purchase_specification:'750ml',content_quantity:'750',content_unit:'ml'}}];
 h.click('編輯全部');h.edit('酒 包裝規格','1500ml');assert.match(h.text(),/9/);assert.equal(h.calls.length,0);
 h.click('匯出');await h.settle();assert.equal(h.exports[0][0][0]['包裝規格'],'750ml');
 const imported=helpers.sheetImports([{'品名':'新酒','數量':'150','單位':'ml','進價':'90','計價規格':'瓶','包裝規格':'750ml'}],h.props.columns,[],{},()=>crypto.randomUUID());
 assert.equal(imported.rows[0].values.amount,'18');assert.equal(imported.rows[0].values.price_unit,'瓶');
});
