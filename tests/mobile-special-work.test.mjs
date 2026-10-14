import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {safeSupplierLink} from '../lib/supplier-prices.ts';
import {supplierPhones,officeFields,supplierFields} from '../lib/supplier-directory.ts';
import {SUPPLIER_CATEGORIES} from '../lib/supplier-categories.ts';
import {directoryState} from '../lib/directory-lifecycle.ts';
import * as spot from '../lib/spot-checks.ts';
const compile=file=>ts.transpileModule(readFileSync(new URL('../app/pilot/'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const icons=Object.fromEntries(['Phone','ExternalLink','Copy','ChevronRight','Download','RefreshCw','ClipboardCheck'].map(k=>[k,()=>null]));
const scope={React,URL,safeSupplierLink,supplierPhones,officeFields,supplierFields,SUPPLIER_CATEGORIES,directoryState,...icons};runInNewContext(compile('mobile-supplier-directory.tsx'),scope);
const supplier={id:'s',name:'DIDA',is_active:true,supplier_category:'食材',line_group:'起司訂貨群',phone:'02-12345678',primary_supplies:'起司',bank_account:'PRIVATE-ACCOUNT',billing_cycle:'SECRET-BILLING'};
const supplierRender=(profiles,extra={})=>renderToStaticMarkup(React.createElement(scope.MobileSupplierDirectory,{profiles,search:'',category:'',loading:false,error:'',notice:'',onBack(){},onSearch(){},onCategory(){},onRefresh(){},onCopy(){},...extra}));
test('mobile supplier cards omit office-only data and removed suppliers',()=>{const html=supplierRender([supplier,{...supplier,id:'paused',name:'停用廠商',is_active:false},{...supplier,id:'removed',name:'移除廠商',is_removed:true}]);assert.match(html,/DIDA|撥打電話|複製群組名稱/);assert.doesNotMatch(html,/PRIVATE-ACCOUNT|SECRET-BILLING|停用廠商|移除廠商|<table|匯出|編輯全部/);assert.match(html,/tel:0212345678/);assert.doesNotMatch(html,/開啟 LINE/);});
test('mobile supplier search uses shared aliases and only safe real contact links',()=>{assert.match(supplierRender([{...supplier,aliases:['乳酪'],order_url:'https://line.me/ti/g/example'}],{search:'乳酪'}),/開啟 LINE/);assert.doesNotMatch(supplierRender([{...supplier,order_url:'javascript:alert(1)'}]),/href="javascript:/);assert.doesNotMatch(supplierRender([supplier],{category:'酒水'}),/DIDA/);});
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
function spotRender(mobileMode,search=''){let i=0;const check={id:'check',store_id:'s',source_month:'2026-10',assignee_id:'u',assignee_name:'現場',status:'OPEN',caps:{plan:true,operate:true},events:[],items:[{entry_id:'a',name:'火腿',supplier:'永豐',zone:'冷藏',unit:'公斤',original_quantity:1,quantity:.8,note:'備料',review_status:'PENDING'},{entry_id:'b',name:'牛奶',supplier:'牧場',zone:'冷藏',unit:'瓶',original_quantity:6,quantity:6,note:'',review_status:'SAME'}]};const seeds={0:'2026-10',1:'pending',2:{caps:check.caps,checks:[]},4:check,9:search,11:{a:'0.8',b:'6'},16:false,19:{a:'備料',b:''}};const s={React,...icons,...spot,localMonth:()=> '2026-10',displayTime:v=>v,useState:v=>{const key=i++;return [key in seeds?seeds[key]:typeof v==='function'?v():v,()=>{}];},useEffect(){},useCallback:f=>f,useRef:v=>({current:v})};runInNewContext(compile('spot-check-workspace.tsx'),s);return s.SpotCheckWorkspace({store:{id:'s',name:'BeApe'},userId:'u',mobileMode,onBack(){}});}
test('mobile spot search filters supplier while desktop retains full table and shared input values',()=>{const mobile=spotRender(true,'永豐');const fields=nodes(mobile).filter(n=>n.type==='input'&&n.props.className==='spot-inline-qty');assert.equal(fields.length,1);assert.equal(fields[0].props.value,'0.8');assert.equal(fields[0].props.disabled,false);assert.equal(nodes(mobile).filter(n=>n.props?.['aria-label']==='搜尋抽盤品項').length,1);const desktop=spotRender(false,'永豐');assert.equal(nodes(desktop).filter(n=>n.type==='input'&&n.props.className==='spot-inline-qty').length,2);assert.equal(nodes(desktop).filter(n=>n.props?.['aria-label']==='搜尋抽盤品項').length,0);});
test('spot header controls do not depend on the unrelated mobile-work shell flag',()=>{
 const mobile=spotRender(true);
 const create=nodes(mobile).find(n=>n.props?.className?.includes('spot-create-action'));
 const refresh=nodes(mobile).find(n=>n.props?.className?.includes('spot-refresh-action'));
 assert.ok(create);assert.equal(refresh.props['aria-label'],'重新讀取');
 const css=readFileSync(new URL('../app/pilot/mobile-special-work.css',import.meta.url),'utf8');
 // Spot-check is a unified mobile page but is not in the shell's data-mobile-work list.
 // Its header rules must apply from the component's own mobile class alone.
 const headerRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>selector.includes('.mobile-spot-workspace>.spot-heading'));
 assert.ok(headerRules.length);
 for(const [,selector] of headerRules)assert.doesNotMatch(selector,/\[data-mobile-work/);
 assert.ok(headerRules.some(([,selector,body])=>selector.includes('.spot-actions button')&&/white-space:nowrap/.test(body)&&/width:auto/.test(body)&&/flex:0 0 auto/.test(body)));
 assert.equal(nodes(spotRender(false)).some(n=>n.props?.className?.includes('spot-create-action')),false);
});
