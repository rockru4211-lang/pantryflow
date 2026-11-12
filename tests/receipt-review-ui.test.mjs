import {SUPPLIER_CATEGORIES,supplierCategory} from '../lib/supplier-categories.ts';
import * as categories from '../lib/receipt-categories.ts';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {runInNewContext} from 'node:vm';import React from 'react';import ts from 'typescript';
import * as h from '../lib/receipt-review.ts';
import * as custody from '../lib/custody-reminders.ts';
import * as workflow from '../lib/receipt-workflow.ts';import * as history from '../lib/receipt-supplier-items.ts';import {accountMoney} from '../lib/receipt-accounting.ts';
const source=fs.readFileSync(new URL('../app/pilot/receipt-review-workbench.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('x.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReceiptReviewWorkbench');
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const row={batch_id:'a',supplier_name:'甲',receipt_date:'2026-09-01',document_number:'A',net:100,tax:5,total:105,adjustment:0,adjustment_note:'',note:'',revision:4,source_fingerprint:'version',can_edit:true,record_state:'LIVE',pending:false,status:'CHECKED',lines:[{row_key:'line-1',product_name:'麵粉',specification:'',quantity:2,unit:'包',unit_price:50,subtotal:100,category:'食材',note:''}],documents:[]};
function nodes(t){return Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];}function text(n){return typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';}
function harness(props={}){const states=[],refs=[],calls=[],saved=[],added=[],created=[],effects=[];let si=0,ri=0,id=0,fail=false,fresh=row,readRows=null,supplierRows=[],supplierEditable=false,custodyRows=[],sharedRows=[],matching={ingredients:[],bindings:[]};const scope={Fragment:React.Fragment,...categories,SUPPLIER_CATEGORIES,supplierCategory,ReceiptStoreField:()=>null,ReceiptEntryMore:()=>null,readScopedReceiptAccounts:async()=>readRows||[fresh],receiptRead:async()=>({data:{fields:[],suppliers:supplierRows,editable:supplierEditable}}),readIngredientMatching:async()=>matching,readSharedReceiptProducts:async()=>sharedRows,receiptReadError:()=>'讀取失敗',createReceiptSupplier:async(store,name,id,category)=>{created.push({store,name,id,category});if(fail)throw Error('NETWORK');return {id:'new-supplier',name,is_active:true,supplier_category:category};},ReceiptPackageInput:()=>null,UnitSelect:()=>null,costingUnits:['公斤','台斤','瓶','包'],useCustodyReminders:()=>({rows:custodyRows,tags:[],error:''}),ReceiptReminderBadge:()=>null,exports:{},React,beginReceiptManualReview:async()=>'manual-run',addReceiptDraftRow:async(s,b,r,id)=>{added.push({s,b,r,id});if(fail)throw Error('NETWORK');return id;},...h,...history,...custody,...workflow,accountMoney,ReceiptHandlingFields:()=>null,ReceiptSourceViewer:()=>null,ReceiptRetakeDialog:()=>null,AbortController,crypto:{randomUUID:()=>String(++id)},Event,window:{confirm:()=>false,dispatchEvent:()=>{}},useState:x=>{const i=si++;if(!(i in states))states[i]=typeof x==='function'?x():x;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:x=>{const i=ri++;return refs[i]||(refs[i]={current:x});},useEffect(fn){effects.push(fn);},useLayoutEffect:fn=>fn(),useCallback:fn=>fn,createReceiptSamePhoto:async(s,b,d,r)=>{calls.push({s,b,d,r});if(fail)throw Error('NETWORK');return {source_account:row,account:{...row,batch_id:'child',lines:[],supplier_name:''}};},correctReceiptStore:async(s,b,t,d,r)=>{calls.push({s,b,t,d,r});if(fail)throw Error('NETWORK');return {...row,moved_to_store_id:t};},saveReceiptReview:async(s,b,d,r)=>{calls.push({s,b,d,r});if(fail)throw Error('NETWORK');return {...row,receipt_categories:d.receipt_categories??row.receipt_categories,edit_revision:1,review_completed:d.review_completed===true,status:d.checked?'CHECKED':'UNCHECKED'};}};runInNewContext(code,scope);const render=()=>{si=0;ri=0;return scope.ReceiptReviewWorkbench({storeId:'store',batchId:'a',nextId:'b',...props,onClose:()=>saved.push('close'),onSaved:(r,n)=>saved.push({r,n})});};render();states[0]=row;states[1]=h.reviewDraft(row);states[2]=JSON.stringify(states[1]);return {states,calls,saved,added,created,effects,setRows:rows=>readRows=rows,setSuppliers:(rows,editable=false)=>{supplierRows=rows;supplierEditable=editable;},setCustody:rows=>custodyRows=rows,setMatching:value=>matching=value,setShared:rows=>sharedRows=rows,render,setFresh:value=>fresh=value,fail:v=>fail=v,find:f=>nodes(render()).find(f),button:l=>nodes(render()).find(n=>n.type==='button'&&(text(n)===l||l==='儲存'&&text(n)==='儲存待補'))};}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('retake uses the selected original page, preserves the editor, and skips a waiting receipt without completing it',()=>{
 const next=[];
 const x=harness({manualEntry:true,onNavigate:id=>next.push(id)});
 const first={id:'first',name:'first.jpg',path:'first',mime_type:'image/jpeg',page_order:1};
 const second={id:'second',name:'second.jpg',path:'second',mime_type:'image/jpeg',page_order:2};
 x.states[0]={...row,documents:[first,second],status:'UNCHECKED'};
 const note=()=>x.find(n=>n.props?.['aria-label']==='貨單對帳備註');
 const action=page=>x.find(n=>n.props?.documentAction).props.documentAction(page);
 const dialog=()=>x.find(n=>n.props?.onRequested);
 note().props.onChange({target:{value:'待保留明細'}});
 action(second).props.onClick();
 assert.equal(dialog(),undefined);
 assert.match(text(x.render()),/請先儲存目前明細/);
 assert.equal(x.states[1].note,'待保留明細');
 assert.equal(x.calls.length,0);
 x.states[2]=JSON.stringify(x.states[1]); // simulate a previously saved draft
 action(second).props.onClick();
 assert.equal(dialog().props.documentId,'second');
 dialog().props.onRequested('second',true);
 assert.equal(dialog(),undefined);
 assert.match(text(x.render()),/原先的原因與說明已保留/);
 assert.equal(action(second).props.disabled,true);
 assert.equal(action(first).props.disabled,false);
 assert.equal(x.states[1].note,'待保留明細');
 assert.equal(x.button('儲存').props.disabled,false);
 assert.equal(x.button('完成建檔並下一張 →'),undefined);
 x.button('下一張 →').props.onClick();
 assert.deepEqual(next,['b']);
 assert.equal(x.calls.length,0);
 assert.equal(x.saved.length,0);
 x.states[0]={...x.states[0],received_at:'2026-09-09'};
 assert.equal(x.find(n=>n.props?.documentAction),undefined);
});
test('actual completed-receipt editor exposes quantity, tax, metadata and notes together',()=>{const x=harness();assert.ok(x.find(n=>n.props?.['aria-label']==='第 1 筆 數量'));assert.ok(x.find(n=>n.props?.['aria-label']==='貨單稅額'));assert.equal(x.find(n=>n.type==='fieldset').props.disabled,false);assert.equal(x.button('完成對帳'),undefined);});
test('failed correction preserves inputs and reuses request token; success alone advances',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'保留我的輸入'}});x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.states[1].note,'保留我的輸入');assert.equal(x.saved.length,0);assert.match(x.states[4],/輸入仍保留/);x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved[0].n,false);});
test('optional tax saves and advances without financial completion',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});assert.equal(x.button('完成對帳'),undefined);x.button('關閉').props.onClick();assert.equal(x.saved.length,0);x.button('完成建檔').props.onClick();await settle();assert.equal(x.calls[0].d.tax,null);assert.equal(x.calls[0].d.checked,false);assert.equal(x.saved[0].n,false);assert.ok(!x.saved.includes('close'));});

test('adding and removing an accidental row does not write until save',()=>{
 const x=harness({manualEntry:true});x.button('＋ 輸入下一項').props.onClick();assert.equal(x.states[1].lines.length,2);assert.equal(x.calls.length,0);assert.equal(x.added.length,0);
 x.find(n=>n.props?.['aria-label']==='刪除第 2 筆').props.onClick();assert.equal(x.states[1].lines.length,1);assert.equal(x.calls.length,0);
 x.button('復原上一項').props.onClick();assert.equal(x.states[1].lines.length,2);assert.ok(x.states[1].lines[1].row_key.startsWith('local-'));
});
test('remove existing line and undo preserves values and order; failed structural save keeps draft and token',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.onClick();assert.equal(x.states[1].lines.length,0);
 x.button('復原上一項').props.onClick();assert.equal(x.states[1].lines[0].product_name,'麵粉');assert.equal(x.states[1].lines[0].quantity,'2');
 x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.onClick();x.button('＋ 輸入下一項').props.onClick();x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.removed_row_keys[0],'line-1');assert.ok(x.calls[0].d.lines[0].row_key.startsWith('local-'));assert.equal(x.saved.length,0);
 x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved.length,1);
});
test('partial entry save remains separate from financial reconciliation',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.tax,null);assert.equal(x.calls[0].d.entry_completed,undefined);assert.equal(x.calls[0].d.checked,false);assert.equal(x.saved[0].n,false);
});
test('posted and custody linked lines cannot be deleted',()=>{
 const x=harness({manualEntry:true});x.states[0]={...x.states[0],receipt_status:'COMPLETED'};assert.equal(x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.disabled,true);assert.equal(x.button('＋ 輸入下一項'),undefined);
 x.states[0]={...x.states[0],receipt_status:'READY_FOR_REVIEW'};x.states[1].lines[0].custody_reminder_id='linked';assert.equal(x.find(n=>n.props?.['aria-label']==='刪除第 1 筆').props.disabled,true);
});

for(const manualEntry of [true,false])test(`entry and accounting share layout and completion behavior (${manualEntry})`,async()=>{
 const x=harness({manualEntry});assert.equal(x.find(n=>n.type==='dialog').props['aria-label'],'貨單核對');assert.match(x.find(n=>n.type==='dialog').props.className,/receipt-unified-workbench/);
 assert.equal(x.find(n=>n.props?.['aria-label']==='調整貨單與明細寬度').props['aria-valuenow'],27);
 assert.equal(x.button('＋ 新增一列'),undefined);assert.ok(x.button('＋ 輸入下一項'));assert.ok(x.button('儲存'));
 x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:''}});
 x.fail(true);x.button('完成建檔').props.onClick();await settle();assert.equal(x.saved.length,0);assert.equal(x.states[1].tax,'');
 x.fail(false);x.button('完成建檔').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.saved[0].n,false);assert.ok(!x.saved.includes('close'));assert.equal(x.calls[1].d.checked,false);assert.equal(x.calls[1].d.entry_completed,true);assert.equal(x.calls[1].d.review_completed,true);assert.equal(x.calls[1].d.reviewed,undefined);assert.equal(x.calls[1].d.confirm_received,undefined);
});
test('previous navigation saves first, stays on failure and retries the same request',async()=>{
 const navigated=[];const x=harness({manualEntry:true,nextId:null,previousId:'older',onNavigate:id=>navigated.push(id)});
 assert.equal(x.button('下一張'),undefined);
 x.find(n=>n.props?.['aria-label']==='貨單到貨日期').props.onChange({target:{value:'2026-09-02'}});
 x.fail(true);x.button('上一張').props.onClick();await settle();assert.deepEqual(navigated,[]);assert.equal(x.states[1].date,'2026-09-02');
 x.fail(false);x.button('上一張').props.onClick();await settle();assert.deepEqual(navigated,['older']);assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.calls[1].d.review_completed,undefined);
});

test('missing prices stay saveable and completion does not post physical receipt',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='第 1 筆 未稅單價').props.onChange({target:{value:''}});
 x.button('完成建檔').props.onClick();await settle();assert.equal(x.calls.length,0);assert.equal(x.button('確認收貨'),undefined);
 x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.saved.length,0);
 x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.calls[1].d.confirm_received,undefined);assert.equal(x.calls[1].d.review_completed,undefined);assert.equal(x.calls[1].d.lines[0].unit_price,null);
});
test('incomplete quantities remain saveable but cannot complete review',async()=>{
 const x=harness({manualEntry:true});x.find(n=>n.props?.['aria-label']==='第 1 筆 數量').props.onChange({target:{value:''}});x.button('完成建檔').props.onClick();await settle();assert.equal(x.calls.length,0);assert.match(x.states[4],/有效數量/);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.lines[0].quantity,null);
});
test('received records expose price supplementation without another receiving action',()=>{
 const x=harness({manualEntry:true});x.states[0]={...x.states[0],receipt_status:'COMPLETED',received_at:'2026-10-14'};
 assert.equal(x.button('確認收貨'),undefined);assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 數量').props.disabled,true);assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 未稅單價').props.disabled,false);
});
test('finance can reconcile from the shared workbench once the saved amounts are ready',async()=>{
 const x=harness({manualEntry:true});x.states[0]={...x.states[0],status:'UNCHECKED',review_completed:true};
 assert.equal(x.button('完成對帳').props.disabled,false);
 x.button('完成對帳').props.onClick();await settle();
 assert.equal(x.calls[0].d.checked,true);
 assert.equal(x.calls[0].d.review_completed,undefined);
 x.states[0]={...x.states[0],status:'MISSING',review_completed:true,tax:null,total:100};
 x.states[1]=h.reviewDraft(x.states[0]);x.states[2]=JSON.stringify(x.states[1]);
 assert.equal(x.button('完成對帳').props.disabled,true);
 assert.match(text(x.render()),/待補稅額/);
});

test('a printed total stays intact when the statement later provides tax',async()=>{
 const x=harness({manualEntry:true});x.states[0]={...x.states[0],source_total:105};
 x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:'0'}});
 assert.equal(x.find(n=>n.props?.['aria-label']==='貨單含稅金額').props.value,'105');
 x.button('儲存').props.onClick();await settle();
 assert.equal(x.calls[0].d.tax,0);assert.equal(x.calls[0].d.total,105);
});

test('tax input immediately fills the total and save carries it without an apply button',async()=>{
 const x=harness();x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:'10'}});
 assert.equal(x.find(n=>n.props?.['aria-label']==='貨單含稅金額').props.value,'110');assert.equal(x.button('帶入含稅金額'),undefined);
 x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.total,110);assert.equal(x.calls[0].d.tax,10);
});

test('footer shows printed total and optional-tax rounding does not block save',async()=>{
 const x=harness({manualEntry:true});x.states[1].lines[0]={...x.states[1].lines[0],quantity:'3.51',unit_price:'880',subtotal:'3088.8'};x.states[1].total='';
 x.find(n=>n.props?.['aria-label']==='貨單稅額').props.onChange({target:{value:'154'}});
 assert.equal(x.states[1].total,'3243');assert.match(text(x.find(n=>n.type==='footer')),/合計 NT\$.*3,243/);
 assert.match(text(x.render()),/四捨五入調整/);assert.match(text(x.render()),/0.2/);
 assert.deepEqual(nodes(x.find(n=>n.type==='footer')).filter(n=>n.type==='button').map(text),['儲存','完成建檔']);
 x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.total,3243);assert.equal(x.calls[0].d.lines[0].subtotal,3088.8);
});

test('quick create supplier preserves invoice input on failure and retries once',async()=>{
 const x=harness();x.setSuppliers([],true);x.effects[1]();await settle();
 x.find(n=>n.props?.['aria-label']==='貨單供應商').props.onChange({target:{value:'新廠商'}});
 x.find(n=>n.props?.['aria-label']==='貨單供應商').props.onFocus();
 x.find(n=>n.props?.['aria-label']==='新供應商分類').props.onChange({target:{value:'酒水'}});
 x.fail(true);x.button('＋ 建立供應商「新廠商」').props.onClick();await settle();assert.equal(x.states[1].supplier,'新廠商');assert.equal(x.calls.length,0);
 x.fail(false);x.button('＋ 建立供應商「新廠商」').props.onClick();await settle();assert.equal(x.created.length,2);assert.equal(x.created[0].id,x.created[1].id);assert.equal(x.created[1].category,'酒水');assert.match(text(x.find(n=>n.props?.className==='receipt-supplier-category')),/酒水/);
 x.find(n=>n.props?.['aria-label']==='貨單供應商').props.onFocus();assert.ok(x.button('新廠商'));assert.equal(x.button('＋ 建立供應商「新廠商」'),undefined);
});

test('loaded unnamed supplier is not an endless loading indicator',()=>{const x=harness();x.states[0]={...x.states[0],supplier_name:''};x.states[1]={...x.states[1],supplier:''};assert.equal(x.find(n=>n.props?.['aria-label']==='貨單供應商').props.value,'');assert.doesNotMatch(text(x.render()),/讀取貨單…/);});
test('opening a receipt never automatically takes over and stops OCR',()=>{assert.doesNotMatch(source,/beginReceiptManualReview/);});
test('recognition recovery is disabled for already saved or received records',()=>{const x=harness();x.states[0]={...x.states[0],edit_revision:2};const panel=x.find(n=>n.props?.onResult);assert.equal(panel.props.hasSavedData,true);});

test('incoming recognition keeps unsaved edits and requires explicit replacement',async()=>{
 const x=harness();x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'不能蓋掉'}});
 x.setFresh({...row,source_fingerprint:'new-ocr',lines:[{...row.lines[0],product_name:'新辨識品項'}]});
 x.find(n=>n.props?.onResult).props.onResult();await settle();
 assert.equal(x.states[1].note,'不能蓋掉');assert.ok(x.button('套用辨識結果'));
 x.button('套用辨識結果').props.onClick();assert.equal(x.states[1].note,'不能蓋掉');
 x.button('保留目前輸入').props.onClick();assert.equal(x.button('套用辨識結果'),undefined);
});
test('incoming recognition fills an untouched editor',async()=>{
 const x=harness();x.setFresh({...row,source_fingerprint:'new-ocr',lines:[{...row.lines[0],product_name:'新辨識品項'}]});
 x.find(n=>n.props?.onResult).props.onResult();await settle();assert.equal(x.states[1].lines[0].product_name,'新辨識品項');
 assert.equal(x.states[2],JSON.stringify(x.states[1]));
});

test('receipt unit dropdown includes custom units across lines and saved store choices',()=>{
 const x=harness();const picker=()=>x.find(n=>n.props?.ariaLabel==='第 1 筆 單位');
 picker().props.onUnitAdded('趟');assert.ok(picker().props.units.includes('趟'));
 picker().props.onChange('趟');assert.equal(picker().props.value,'趟');
});

test('complete and next advances only after confirmed save without closing or posting finance',async()=>{
 const navigated=[];const x=harness({manualEntry:true,onNavigate:id=>navigated.push(id)});
 assert.equal(x.button('下一張'),undefined);
 x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'連續建檔'}});
 x.fail(true);x.button('完成建檔並下一張 →').props.onClick();await settle();assert.deepEqual(navigated,[]);assert.equal(x.states[1].note,'連續建檔');
 x.fail(false);x.button('完成建檔並下一張 →').props.onClick();await settle();
 assert.deepEqual(navigated,['b']);assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.calls[1].d.review_completed,true);assert.equal(x.calls[1].d.checked,false);assert.equal(x.calls[1].d.confirm_received,undefined);assert.ok(!x.saved.includes('close'));
});
test('last completion remains in the editor and plain Save never navigates',async()=>{
 const navigated=[];const x=harness({manualEntry:true,nextId:null,onNavigate:id=>navigated.push(id)});
 x.button('儲存').props.onClick();await settle();assert.deepEqual(navigated,[]);assert.ok(!x.saved.includes('close'));
 x.button('完成建檔').props.onClick();await settle();assert.deepEqual(navigated,[]);assert.ok(!x.saved.includes('close'));assert.match(text(x.render()),/已完成建檔/);
});

test('selecting a supplier displays a read-only classification and persists it across retries',async()=>{
 const x=harness(),current={...row,edit_revision:0,status:'UNCHECKED',supplier_name:'',receipt_categories:[]};
 x.states[0]=current;x.states[1]=h.reviewDraft(current);x.render();
 x.setSuppliers([{id:'supplier',name:'豪野鴨',supplier_category:'食材'},{id:'wine',name:'酒商',supplier_category:'酒水'}]);
 x.effects[1]();await settle();
 const supplier=()=>x.find(n=>n.props?.['aria-label']==='貨單供應商');
 supplier().props.onFocus();x.button('豪野鴨').props.onClick();
 const category=()=>x.find(n=>n.props?.['aria-label']==='貨單分類');
 assert.equal(category().type,'div');assert.equal(text(category()),'食材依供應商帶入');
 supplier().props.onChange({target:{value:'酒'}});
 assert.equal(category(),undefined);
 x.button('酒商').props.onClick();assert.equal(text(category()),'酒水依供應商帶入');
 x.button('分類、備註與寄庫').props.onClick();
 assert.equal(category().type,'div');
 x.fail(true);x.button('儲存').props.onClick();await settle();
 assert.deepEqual(Array.from(x.states[1].receiptCategories),['酒水']);
 x.fail(false);x.button('儲存').props.onClick();await settle();
 assert.equal(x.calls[0].r,x.calls[1].r);
 assert.deepEqual(Array.from(x.calls[1].d.receipt_categories),['酒水']);
 assert.equal(x.calls[1].d.lines[0].category,'食材');
});

test('received invoices keep their stored tags and lock the supplier and received quantities',()=>{
 const x=harness(),current={...row,received_at:'2026-10-17',receipt_categories:['食材','舊標籤']};
 x.states[0]=current;x.states[1]=h.reviewDraft(current);
 assert.equal(text(x.find(n=>n.props?.['aria-label']==='貨單分類')),'食材、舊標籤');
 assert.equal(x.find(n=>n.props?.['aria-label']==='貨單供應商').props.disabled,true);
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 數量').props.disabled,true);
});

test('store correction is a header field and saves with the current draft atomically',async()=>{
 const x=harness();const field=x.find(n=>n.type?.name==='ReceiptStoreField');assert.ok(field);assert.equal(field.props.value,'store');assert.ok(nodes(x.find(n=>n.props?.className==='receipt-entry-metadata')).some(n=>n.type===field.type));
 field.props.onChange('target');x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'移轉保留'}});
 x.fail(true);x.button('儲存').props.onClick();await settle();assert.equal(x.saved.length,0);assert.equal(x.find(n=>n.type?.name==='ReceiptStoreField').props.value,'target');
 x.fail(false);x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.calls[1].t,'target');assert.equal(x.calls[1].d.note,'移轉保留');assert.ok(x.saved.includes('close'));
});

test('same photo stays in More; failed atomic creation preserves draft and retry token before navigating to blank child',async()=>{
 const navigated=[];const x=harness({onNavigate:id=>navigated.push(id)});x.states[0]={...row,documents:[{id:'doc',path:'original',name:'receipt.jpg'}]};
 const more=x.find(n=>n.props?.onResult);assert.ok(nodes(more).some(n=>text(n)==='同照片新增貨單'));
 x.find(n=>n.props?.['aria-label']==='貨單對帳備註').props.onChange({target:{value:'保留第一張'}});
 x.fail(true);x.button('同照片新增貨單').props.onClick();await settle();assert.deepEqual(navigated,[]);assert.equal(x.states[1].note,'保留第一張');assert.equal(x.saved.length,0);
 x.fail(false);x.button('同照片新增貨單').props.onClick();await settle();assert.equal(x.calls[0].r,x.calls[1].r);assert.equal(x.calls[1].d.note,'保留第一張');assert.deepEqual(navigated,['child']);assert.equal(x.saved[1].r.lines.length,0);
});
test('same-photo creation does not rewrite a clean source and is hidden without originals or edit permission',async()=>{
 const x=harness({onNavigate:()=>{}});assert.equal(x.button('同照片新增貨單'),undefined);x.states[0]={...row,documents:[{id:'doc',path:'original'}]};x.button('同照片新增貨單').props.onClick();await settle();assert.equal(x.calls[0].d,null);x.states[0]={...x.states[0],can_edit:false};assert.equal(x.button('同照片新增貨單'),undefined);
});

test('supplier master wins over past invoices and resolves a complete alias',async()=>{
 const x=harness(),current={...row,edit_revision:0,status:'UNCHECKED',supplier_name:'舊甲',receipt_categories:[],lines:[{...row.lines[0],category:'待分類'}]};
 x.states[0]=current;x.states[1]=h.reviewDraft(current);x.render();
 x.setRows([current,{...current,batch_id:'history',edit_revision:1,receipt_categories:['酒水']}]);
 x.effects[0]();await settle();assert.deepEqual(Array.from(x.states[1].receiptCategories),[]);
 x.setSuppliers([{id:'supplier',name:'甲',aliases:['舊甲'],supplier_category:'食材'}]);x.effects[1]();await settle();
 assert.deepEqual(Array.from(x.states[1].receiptCategories),['食材']);
 assert.equal(x.states[1].lines[0].category,'食材');
 assert.equal(x.states[1].lines[0].unit_price,'50');assert.equal(x.calls.length,0);
});

test('late matching data prioritizes the item category without rewriting its identity or price',async()=>{
 const x=harness(),current={...row,edit_revision:0,status:'UNCHECKED',receipt_categories:[],lines:[{...row.lines[0],product_name:'洗碗精',unit:'瓶',category:'待分類'}]};
 x.states[0]=current;x.states[1]=h.reviewDraft(current);x.render();
 x.setSuppliers([{id:'supplier',name:'甲',supplier_category:'食材'}]);x.effects[1]();await settle();assert.equal(x.states[1].lines[0].category,'食材');
 x.setMatching({ingredients:[{id:'cleaner',name:'洗碗精',unit:'瓶',category:'耗材',aliases:[]}],bindings:[]});x.effects[2]();await settle();
 assert.equal(x.states[1].lines[0].category,'耗材');assert.equal(x.states[1].lines[0].categorySource,'item');assert.equal(x.states[1].lines[0].ingredient_id,undefined);assert.equal(x.states[1].lines[0].unit_price,'50');assert.equal(x.calls.length,0);
});

test('a user-selected unclassified item survives invoice changes and async category loading',async()=>{
 const x=harness(),current={...row,edit_revision:0,status:'UNCHECKED',receipt_categories:[],lines:[{...row.lines[0],category:'待分類'}]};
 x.states[0]=current;x.states[1]=h.reviewDraft(current);
 x.button('分類、備註與寄庫').props.onClick();
 x.find(n=>n.props?.['aria-label']==='第 1 筆 分類').props.onChange({target:{value:'待分類'}});
 x.setSuppliers([{id:'supplier',name:'甲',supplier_category:'食材'}]);x.effects[1]();await settle();assert.equal(x.states[1].lines[0].category,'待分類');
 x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.lines[0].category,'待分類');assert.equal('categorySource' in x.calls[0].d.lines[0],false);
});

test('editing an older invoice preserves its tags and saved line classifications',async()=>{
 const x=harness(),saved={...row,edit_revision:2,receipt_categories:['酒水'],lines:[{...row.lines[0],category:'待分類'}]};
 x.states[0]=saved;x.states[1]=h.reviewDraft(saved);x.render();x.setSuppliers([{id:'supplier',name:'甲',supplier_category:'食材'}]);x.effects[1]();await settle();
 assert.deepEqual(Array.from(x.states[1].receiptCategories),['酒水']);
 assert.equal(text(x.find(n=>n.props?.['aria-label']==='貨單分類')),'酒水');
 x.button('＋ 輸入下一項').props.onClick();assert.equal(x.states[1].lines[1].category,'酒水');
 x.button('儲存').props.onClick();await settle();
 assert.equal(x.calls[0].d.lines[0].category,'待分類');
 assert.deepEqual(Array.from(x.calls[0].d.receipt_categories),['酒水']);
});

test('supplier data resolving after initial receipt loading works even before the next render',async()=>{
 const x=harness(),current={...row,edit_revision:0,status:'UNCHECKED',receipt_categories:[],lines:[{...row.lines[0],category:'待分類'}]};
 x.states[0]=null;x.states[1]=null;x.render();x.setRows([current]);
 x.effects[3]();await settle();
 x.setSuppliers([{id:'supplier',name:'甲',supplier_category:'酒水'}]);x.effects[1]();await settle();
 assert.deepEqual(Array.from(x.states[1].receiptCategories),['酒水']);assert.equal(x.states[1].lines[0].category,'酒水');
});

test('matching supplier alias offers the canonical choice without duplicate creation',async()=>{
 const x=harness();x.setSuppliers([{id:'canonical',name:'正式廠商',aliases:['舊別名']}],true);x.effects[1]();await settle();
 x.find(n=>n.props?.['aria-label']==='貨單供應商').props.onChange({target:{value:'舊別'}});
 assert.ok(x.button('正式廠商'));assert.equal(x.button('＋ 建立供應商「舊別」'),undefined);
 x.button('正式廠商').props.onClick();assert.equal(x.states[1].supplier,'正式廠商');assert.equal(x.created.length,0);
});

test('discount stays behind More, expands inline, saves net prices and preserves original price',async()=>{
 const x=harness();assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 折讓'),undefined);
 const headings=()=>nodes(x.find(n=>n.type==='thead')).filter(n=>n.type==='th'&&!n.props.hidden).map(text);
 const originalHeadings=headings();
 x.button('折扣').props.onClick();
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 折讓'),undefined);
 x.button('逐項折扣').props.onClick();
 const discountRow=x.find(n=>n.props?.className==='receipt-line-discount-row');
 assert.equal(discountRow.props.children.props.colSpan,7);
 assert.ok(nodes(discountRow).some(n=>n.props?.['aria-label']==='第 1 筆 折讓'));
 assert.deepEqual(headings(),originalHeadings);
 x.button('分類、備註與寄庫').props.onClick();
 assert.equal(x.find(n=>n.props?.className==='receipt-line-discount-row').props.children.props.colSpan,9);
 x.find(n=>n.props?.['aria-label']==='第 1 筆 折讓').props.onChange({target:{value:'30'}});
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 未稅單價').props.value,'50');
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 未稅金額').props.value,'70');
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 未稅金額').props.readOnly,true);
 x.button('收起折扣').props.onClick();assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 折讓'),undefined);
 assert.ok(x.find(n=>n.type==='small'&&text(n)==='折讓 30%'));
 x.button('儲存').props.onClick();await settle();assert.equal(x.calls[0].d.lines[0].unit_price,35);assert.equal(x.calls[0].d.lines[0].discount.base_price,50);
});

test('custody is set under More per line and can complete with or without the printed balance',async()=>{
 for(const [input,expected] of [['48',48],['0',0],['',null]]){
  const x=harness({manualEntry:true});
  const source={...row,status:'UNCHECKED',tax:null,total:null,lines:[
   {...row.lines[0],product_name:'加拿大頂級鴨肝切片',quantity:1,unit_price:null,subtotal:null},
   {...row.lines[0],row_key:'line-2',product_name:'無鹽奶油',quantity:2},
  ]};
  x.states[0]=source;x.states[1]=h.reviewDraft(source);x.states[2]=JSON.stringify(x.states[1]);
  const fields=index=>x.find(n=>n.props?.index===index&&n.props?.line?.row_key===source.lines[index].row_key);
  assert.equal(fields(0).props.editing,false);
  x.button('分類、備註與寄庫').props.onClick();
  assert.equal(fields(0).props.editing,true);
  fields(0).props.onChange('handling','CUSTODY_RELEASE');
  fields(0).props.onChange('custody_remaining',input);
  assert.equal(fields(1).props.line.handling,undefined);
  x.button('完成建檔').props.onClick();await settle();
  const [custody,regular]=x.calls[0].d.lines;
  assert.equal(custody.custody_remaining,expected);
  assert.equal(custody.quantity,1);
  assert.equal(custody.custody_reminder_id,'');
  assert.equal(custody.custody_lot_id,'');
  assert.equal(custody.unit_price,null);
  assert.equal(custody.subtotal,0);
  assert.equal(regular.custody_remaining,undefined);
  assert.equal(x.calls[0].d.review_completed,true);
  assert.equal(x.calls[0].d.checked,false);
 }
});

test('catalog exclusion previews blank OCR rows and requires confirmation before editing the draft',async()=>{
 const x=harness({manualEntry:true});
 const source={...row,receipt_status:'READY_FOR_REVIEW',lines:[
  {...row.lines[0],row_key:'line-1',product_name:'預印飼料',quantity:null,unit:'3KG',unit_price:null,subtotal:null},
  {...row.lines[0],row_key:'line-2',product_name:'預印鈣粉',quantity:null,unit:'20KG',unit_price:null,subtotal:null},
  {...row.lines[0],row_key:'line-3',product_name:'蝸牛肉'},
 ]};
 x.states[0]=source;x.states[1]=h.reviewDraft(source);x.states[2]=JSON.stringify(x.states[1]);
 x.button('批次排除未採購列').props.onClick();
 assert.match(text(x.find(n=>n.props?.['aria-label']==='預覽排除未採購列')),/預印飼料.*預印鈣粉/);
 assert.doesNotMatch(text(x.find(n=>n.props?.['aria-label']==='預覽排除未採購列')),/蝸牛肉/);
 assert.equal(x.button('排除已勾選 0 列').props.disabled,true);
 x.button('全選建議排除列').props.onClick();
 x.button('排除已勾選 2 列').props.onClick();
 assert.equal(x.calls.length,0);
 assert.deepEqual(Array.from(x.states[1].lines,l=>l.product_name),['蝸牛肉']);
 x.button('儲存').props.onClick();await settle();
 assert.deepEqual(Array.from(x.calls[0].d.removed_row_keys),['line-1','line-2']);
});

test('the workbench offers a shared item by code and uses its standard name without copying a price',async()=>{
 const x=harness();
 x.setShared([{id:'shared',name:'黃檸檬',product_code:'BH-012',base_unit:'台斤',specification:''}]);
 x.effects[7]();await settle();
 const name=()=>x.find(n=>n.props?.['aria-label']==='第 1 筆 品名');
 x.states[1].lines[0]={...x.states[1].lines[0],unit:'',specification:'',unit_price:'',subtotal:''};
 name().props.onChange({target:{value:'BH-012'}});
 assert.match(text(x.render()),/兩店共用品項/);
 const choice=x.find(n=>n.type==='button'&&text(n).includes('黃檸檬')&&text(n).includes('BH-012'));
 assert.ok(choice);
 choice.props.onClick();
 assert.equal(x.states[1].lines[0].product_name,'黃檸檬');
 assert.equal(x.states[1].lines[0].unit,'台斤');
 assert.equal(x.states[1].lines[0].unit_price,'');
});

test('confirmed supplier matches display specification ahead of code without repeating the history choice',async()=>{
 const x=harness();
 x.setShared([
  {id:'a',name:'蘿莉塔娜礦泉水',product_code:'W1',base_unit:'瓶',specification:'750ml'},
  {id:'b',name:'蘿莉塔娜氣泡水',product_code:'W2',base_unit:'瓶',specification:'750ml'},
 ]);
 x.setRows([row,{...row,batch_id:'old',lines:[{...row.lines[0],product_name:'蘿莉塔娜氣泡水',unit:'瓶',specification:'750毫升'}]}]);
 x.effects[0]();x.effects[7]();await settle();
 x.states[1].lines[0]={...x.states[1].lines[0],unit:'瓶',specification:''};
 const name=()=>x.find(n=>n.props?.['aria-label']==='第 1 筆 品名');
 name().props.onChange({target:{value:'蘿莉塔娜'}});
 name().props.onFocus({currentTarget:{select(){}}});await settle();
 const picker=x.find(n=>n.props?.['aria-label']==='品項快選');
 const choices=nodes(picker).filter(n=>n.type==='button');
 assert.match(text(picker),/本供應商已核對.*氣泡水.*兩店共用品項.*礦泉水/);
 assert.deepEqual(choices.slice(0,2).map(text),['蘿莉塔娜氣泡水750ml · 瓶 · W2','蘿莉塔娜礦泉水750ml · 瓶 · W1']);
 assert.equal(choices.filter(choice=>text(choice).includes('氣泡水')).length,1);
});

test('document discount defaults to a one-time cash deduction and leaves line costs unchanged',async()=>{
 const x=harness();
 x.button('折扣').props.onClick();
 const field=x.find(n=>n.props?.['aria-label']==='整張折扣方式');
 assert.equal(field.props.value,'AMOUNT');
 x.find(n=>n.props?.['aria-label']==='整張折扣').props.onChange({target:{value:'15'}});
 x.button('套用折扣').props.onClick();
 x.button('儲存').props.onClick();
 await settle();
 assert.equal(x.calls[0].d.adjustment,-15);
 assert.equal(x.calls[0].d.total,90);
 assert.equal(x.calls[0].d.lines[0].unit_price,50);
 assert.equal(x.calls[0].d.receipt_entry_metadata.discount.amount,15);
});

test('equipment classification replaces inventory fields and completes with the uploaded original intact',async()=>{
 const x=harness();
 const current={...row,status:'UNCHECKED',documents:[{id:'doc',name:'source.jpg',path:'source'}],checked_at:null};
 x.states[0]=current;
 x.states[1]=h.reviewDraft(current);
 x.states[2]=JSON.stringify(x.states[1]);
 x.find(n=>n.props?.['aria-label']==='單據性質').props.onChange({target:{value:'MAINTENANCE'}});
 const name=x.find(n=>n.type==='label'&&text(n)==='設備名稱').props.children[1];
 name.props.onChange({target:{value:'製冰機'}});
 assert.equal(x.find(n=>n.props?.['aria-label']==='第 1 筆 數量'),undefined);
 assert.equal(x.find(n=>n.props?.documents)?.props.documents[0].id,'doc');
 x.button('完成建檔').props.onClick();
 await settle();
 assert.equal(x.calls[0].d.receipt_entry_metadata.equipment.kind,'MAINTENANCE');
 assert.equal(x.calls[0].d.receipt_entry_metadata.equipment.name,'製冰機');
 assert.deepEqual(Array.from(x.calls[0].d.removed_row_keys),['line-1']);
 assert.equal(x.calls[0].d.lines.length,0);
 assert.equal(x.calls[0].d.review_completed,true);
});

test('a line opened from purchase details stays identifiable while ordinary receipts can be saved and reconciled',async()=>{
 const x=harness({initialRowKey:'line-1'});
 const invoice={...row,status:'UNCHECKED'};
 x.states[0]=invoice;x.states[1]=h.reviewDraft(invoice);x.states[2]=JSON.stringify(x.states[1]);
 const target=x.find(n=>n.props?.['data-receipt-row']==='line-1');
 assert.equal(target.props.className,'receipt-focused-row');
 assert.equal(target.props.tabIndex,-1);
 x.button('完成建檔').props.onClick();await settle();
 assert.equal(x.calls[0].d.review_completed,true);
 assert.equal(x.calls[0].d.checked,false);
 assert.equal(x.button('完成建檔'),undefined);
 x.button('完成對帳').props.onClick();await settle();
 assert.equal(x.calls[1].d.checked,true);
 assert.equal(x.calls[1].d.total,105);
 assert.equal(x.calls[1].d.lines[0].subtotal,100);
});
