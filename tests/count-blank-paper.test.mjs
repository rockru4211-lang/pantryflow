import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { blankCountPaperZones, blankCountPaperHtml, openBlankCountPaper } from '../lib/count-blank-paper.ts';

const configured=[
  {id:'cold',name:'冷藏區',zone_products:[
    {product_id:'milk',count_unit:'箱',products:{name:'鮮奶',specification:'1 L',suppliers:{name:'乳品商'},is_active:true}},
    {product_id:'ham',count_unit:'包',products:{name:'伊比利火腿',specification:null,suppliers:[{name:'食品商'}]}},
    {product_id:'new',count_unit:'袋',products:{name:'新建品項'}},
  ]},
  {id:'dry',name:'常溫區',zone_products:[{product_id:'flour',count_unit:'公斤',products:{name:'麵粉'}}]},
];
const snapshot=[
  {zone_id:'cold',zone_name:'冷藏區',product_id:'ham',product_name:'火腿',unit:'包'},
  {zone_id:'cold',zone_name:'冷藏區',product_id:'milk',product_name:'鮮奶',unit:'瓶'},
  {zone_id:'cold',zone_name:'冷藏區',product_id:'missing',product_name:'快照保留品項',unit:'個',supplier:'快照供應商'},
  {zone_id:'archived',zone_name:'舊儲物區',product_id:'history',product_name:'快照區域品項',unit:'件'},
];
test('active paper keeps exactly the snapshot pairs, frozen units and current app order',()=>{
  const paper=blankCountPaperZones(configured,snapshot);
  assert.deepEqual(paper.map(zone=>zone.id),['cold','archived']);
  assert.deepEqual(paper[0].items.map(item=>item.id),['milk','ham','missing']);
  assert.equal(paper[0].items[0].unit,'瓶');
  assert.equal(paper[0].items[2].supplier,'快照供應商');
  assert.equal(paper[1].items[0].name,'快照區域品項');
  assert.equal(paper.flatMap(zone=>zone.items).length,snapshot.length);
  assert.equal(JSON.stringify(paper).includes('新建品項'),false);
});
test('before a new count paper uses current configuration and an empty active scope stays empty',()=>{
  const paper=blankCountPaperZones(configured);
  assert.deepEqual(paper.map(zone=>zone.id),['cold','dry']);
  assert.equal(paper[0].items[0].unit,'箱');assert.equal(paper[0].items[2].name,'新建品項');
  assert.deepEqual(blankCountPaperZones(configured,[]),[]);
});
test('a same-product pair in another area remains separate and deactivation cannot erase an active snapshot item',()=>{
  const zones=[...configured,{id:'bar',name:'吧台',zone_products:[{product_id:'milk',count_unit:'瓶',products:{name:'鮮奶',is_active:false}}]}];
  const scoped=[...snapshot,{zone_id:'bar',zone_name:'吧台',product_id:'milk',product_name:'鮮奶',unit:'瓶'}];
  assert.equal(blankCountPaperZones(zones,scoped).flatMap(zone=>zone.items).filter(item=>item.id==='milk').length,2);
  assert.equal(blankCountPaperZones(zones).some(zone=>zone.id==='bar'),false);
});
test('handwriting cells are empty even when input objects contain zero, notes, stock and price',()=>{
  const zones=blankCountPaperZones(configured,snapshot);
  for(const zone of zones)for(const item of zone.items)Object.assign(item,{quantity:0,note:'不可洩漏本期備註',unit_price:9876.54,opening_quantity:55555});
  const html=blankCountPaperHtml('測試門市',zones);
  assert.equal((html.match(/class="handwriting quantity"><\/td>/g)||[]).length,4);
  assert.equal((html.match(/class="handwriting note"><\/td>/g)||[]).length,4);
  assert.doesNotMatch(html,/不可洩漏本期備註|9876\.54|55555|單價|庫存|系統數量/);
  assert.match(html,/日期：<i class="date-line"><\/i>/);assert.match(html,/盤點人：<i class="counter-line"><\/i>/);
  assert.match(html,/<tfoot>.*未填不代表 0/);
});
test('all dynamic printable strings are escaped, with no remote or executable content',()=>{
  const malicious='<img src="x" onerror="alert(1)">&\'品項';
  const html=blankCountPaperHtml(malicious,[{id:'z',name:malicious,items:[{id:'p',name:malicious,specification:malicious,supplier:malicious,unit:malicious}]}]);
  assert.doesNotMatch(html,/<img|<script|onerror="|<link|<iframe/);
  assert.match(html,/&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;品項/);
});
test('long areas use automatic A4 pagination with repeated headers/footers and separate area pages',()=>{
  const long={id:'long',name:'長區域',items:Array.from({length:300},(_,index)=>({id:String(index),name:`品項${index} ${'較長名稱'.repeat(10)}`,specification:'規格'.repeat(20),supplier:'廠商'.repeat(10),unit:'包'}))};
  const html=blankCountPaperHtml('門市',[long,{id:'other',name:'次區域',items:[{id:'last',name:'末筆',specification:'',supplier:'',unit:'瓶'}]}]);
  assert.equal((html.match(/<section class="paper-zone">/g)||[]).length,2);
  assert.equal((html.match(/class="handwriting quantity"/g)||[]).length,301);
  assert.match(html,/size:A4 portrait/);assert.match(html,/break-after:page/);assert.match(html,/thead\{display:table-header-group/);assert.match(html,/tfoot\{display:table-footer-group/);
  assert.match(html,/overflow-wrap:anywhere/);assert.match(html,/counter\(page\)/);
});

function withPrintBrowser(run,options={}){
  const oldWindow=globalThis.window,oldSetTimeout=globalThis.setTimeout,oldClearTimeout=globalThis.clearTimeout;
  const events=[],listeners=new Map(),timers=new Map();let counter=0;
  const popup={closed:false,opener:{},document:{readyState:'loading',open(){events.push('document.open');listeners.clear();},write(html){events.push('write');this.html=html;},close(){events.push('document.close');if(!options.neverLoaded){this.readyState='complete';listeners.get('load')?.();}}},
    focus(){events.push('focus');},print(){events.push('print');if(options.printThrows)throw new Error('print failed');if(options.earlyAfterprint)listeners.get('afterprint')?.();},close(){events.push('close');this.closed=true;},
    addEventListener(name,handler){listeners.set(name,handler);},removeEventListener(name){listeners.delete(name);}};
  globalThis.window={open(){events.push('window.open');if(options.openThrows)throw new Error('blocked');return options.blocked?null:popup;},print(){assert.fail('must never print the app document');}};
  globalThis.setTimeout=callback=>{const id=++counter;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
  try{return run({popup,events,listeners,timers});}finally{globalThis.window=oldWindow;globalThis.setTimeout=oldSetTimeout;globalThis.clearTimeout=oldClearTimeout;}
}
test('printing opens synchronously and prints only the isolated document after its load',()=>{
  withPrintBrowser(({popup,events,listeners,timers})=>{
    assert.equal(openBlankCountPaper('<html>empty sheet</html>',()=>assert.fail('should print')),true);
    assert.deepEqual(events,['window.open','document.open','write','document.close','focus','print']);
    assert.equal(popup.document.html,'<html>empty sheet</html>');assert.equal(popup.opener,null);
    assert.equal(timers.size,0);listeners.get('afterprint')();assert.equal(listeners.size,0);assert.equal(popup.closed,false);
  });
});
test('Safari early afterprint cannot close the document underneath the print dialog',()=>{
  withPrintBrowser(({popup,listeners})=>{openBlankCountPaper('paper',()=>assert.fail());assert.equal(popup.closed,false);assert.equal(listeners.size,0);},{earlyAfterprint:true});
});
test('blocked popups, failed print and stalled loading give retry messages and clean resources',()=>{
  for(const options of [{blocked:true},{openThrows:true},{printThrows:true},{neverLoaded:true}])withPrintBrowser(({popup,timers,listeners})=>{
    const notices=[];openBlankCountPaper('paper',message=>notices.push(message));
    if(options.neverLoaded)for(const callback of [...timers.values()])callback();
    assert.equal(notices.length,1);assert.match(notices[0],/列印|視窗/);
    if(options.printThrows||options.neverLoaded){assert.equal(popup.closed,true);assert.equal(listeners.size,0);assert.equal(timers.size,0);}
  },options);
});

const jsx=await import('react/jsx-runtime');
const uiSource=readFileSync(new URL('../app/pilot/count-blank-paper.tsx',import.meta.url),'utf8');
const uiAst=ts.createSourceFile('paper.tsx',uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const ui=uiAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CountBlankPaper');
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:'paper.tsx'}).outputText;
function paperControl(selected,options={}){
  const zones=blankCountPaperZones(configured),calls=[];
  const scope={exports:{},require:()=>jsx,open:true,selected,storeName:'門市',zones,disabled:false,notice:'',trigger:{current:null},dialog:{current:null},Printer:()=>null,X:()=>null,setSelected:value=>calls.push({selected:value}),setNotice(){},setOpen(){},close:()=>calls.push('close'),blankCountPaperHtml:(name,rows)=>{calls.push({name,zones:rows.map(zone=>zone.id)});return 'isolated paper';},openBlankCountPaper:html=>{calls.push(html);return true;},...options};
  for(const name of ['chosen','allSelected']){
    const variable=ui.body.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations]).find(node=>node.name.getText(uiAst)===name);
    runInNewContext(compile(`globalThis.${name}=(${variable.initializer.getText(uiAst)});`),scope);
  }
  const expression=ui.body.statements.find(ts.isReturnStatement).expression;
  runInNewContext(compile(`globalThis.result=(${expression.getText(uiAst)});`),scope);
  return {element:scope.result,calls};
}
function findElement(node,predicate){if(!React.isValidElement(node))return; if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const result=findElement(child,predicate);if(result)return result;}}
test('the actual selection UI prints only selected areas in app order without starting or saving a count',()=>{
  const one=paperControl(['dry']);
  const print=findElement(one.element,node=>node.type==='button'&&node.props.className==='shell-primary');
  print.props.onClick();
  assert.deepEqual(one.calls,[{name:'門市',zones:['dry']},'isolated paper','close']);
  const multiple=paperControl(['dry','cold']);
  findElement(multiple.element,node=>node.type==='button'&&node.props.className==='shell-primary').props.onClick();
  assert.deepEqual(multiple.calls[0].zones,['cold','dry']);
  assert.match(renderToStaticMarkup(multiple.element),/全部區域/);
});
test('empty selection and stale workspace data disable the actual print action',()=>{
  for(const sample of [paperControl([]),paperControl(['cold'],{disabled:true})]){
    const print=findElement(sample.element,node=>node.type==='button'&&node.props.className==='shell-primary');
    assert.equal(print.props.disabled,true);
  }
});
