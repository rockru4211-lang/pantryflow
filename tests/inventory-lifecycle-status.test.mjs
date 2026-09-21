import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {catalogState,catalogStates,importRowState,importRowLabel,summarizeImportRows} from '../lib/inventory-import-status.ts';

const active=id=>({product_id:id,catalog_state:'ACTIVE',product_is_active:true,is_removed:false,is_configured:true});
const removed=id=>({...active(id),catalog_state:'REMOVED',is_removed:true,is_configured:false});
const disabled=id=>({...active(id),catalog_state:'DISABLED',product_is_active:false});

test('import source rows and current countable products have separate, deduplicated totals',()=>{
  const rows=Array.from({length:199},(_,i)=>({product_id:`p${i}`,status:i<80?'ADDED':'EXISTING'}));
  const catalog=rows.map((row,i)=>i<138?active(row.product_id):removed(row.product_id));
  const summary=summarizeImportRows(rows,catalogStates(catalog));
  assert.deepEqual(summary,{sourceRows:199,builtRows:199,ready:138,removed:61,disabled:0,unconfigured:0,failed:0,unknown:0,skipped:0});
  const repeated=summarizeImportRows([...rows,rows[0]],catalogStates([...catalog,active('p0')]));
  assert.equal(repeated.builtRows,200);
  assert.equal(repeated.ready,138,'Repeated source rows and zones do not create additional products');
});
test('manual deactivation, removal, failed import and missing state stay distinct',()=>{
  const states=catalogStates([active('a'),disabled('d'),removed('r')]);
  const rows=[{product_id:'a',status:'ADDED'},{product_id:'d',status:'EXISTING'},{product_id:'r',status:'EXISTING'},
    {product_id:null,status:'FAILED'},{product_id:'missing',status:'ADDED'},{product_id:null,status:'SKIPPED'}];
  assert.deepEqual(rows.map(row=>importRowState(row,states)),['ACTIVE','DISABLED','REMOVED','FAILED','UNKNOWN','SKIPPED']);
  assert.deepEqual(summarizeImportRows(rows,states),{sourceRows:6,builtRows:4,ready:1,disabled:1,removed:1,unconfigured:0,failed:1,unknown:1,skipped:1});
});
test('rejoining a removed disabled product does not classify it as active',()=>{
  assert.equal(catalogState({...removed('a'),product_is_active:false}),'REMOVED');
  assert.equal(catalogState(disabled('a')),'DISABLED');
  assert.equal(catalogState(active('a')),'ACTIVE');
  for(const incomplete of [{product_id:'a',is_active:true},{...removed('a'),is_removed:false},{...active('a'),product_is_active:undefined}])assert.equal(catalogState(incomplete),'UNKNOWN');
  assert.equal(catalogStates([active('a'),disabled('a')]).get('a'),'UNKNOWN');
});
test('known active products without a zone await configuration instead of becoming removed or ready',()=>{
  const states=catalogStates([{...active('p'),is_configured:false}]);
  assert.equal(states.get('p'),'UNCONFIGURED');
  const summary=summarizeImportRows([{product_id:'p',status:'ADDED'}],states);
  assert.equal(summary.ready,0);assert.equal(summary.removed,0);assert.equal(summary.unconfigured,1);
});
test('a removed source row cannot claim readiness just because another import uses its product',()=>{
  const state=importRowState({product_id:'shared',status:'SKIPPED'},catalogStates([active('shared')]));
  assert.equal(state,'REMOVED');
  assert.equal(importRowLabel({product_id:'shared',status:'SKIPPED'},catalogStates([active('shared')])),'來源已移除');
});

function actualHandler(filename,component,name,scope){
  const source=readFileSync(new URL(`../app/pilot/${filename}`,import.meta.url),'utf8');
  const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===component);
  assert.ok(fn?.body);
  let code;
  for(const node of fn.body.statements){
    if(ts.isFunctionDeclaration(node)&&node.name?.text===name)code=node.getText(ast);
    if(ts.isVariableStatement(node)){
      const variable=node.declarationList.declarations.find(item=>item.name.getText(ast)===name);
      if(variable?.initializer)code=`globalThis.${name}=(${variable.initializer.getText(ast)});`;
    }
  }
  assert.ok(code,`Actual ${component}.${name} must exist`);
  runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});
  return scope[name];
}
test('actual store lifecycle and explicit activation call different server operations',async()=>{
  const calls=[];
  const scope={storeId:'store-a',setBusy:()=>{},setNotice:()=>{},setSelectedIds:()=>{},setRevision:()=>{},onChanged:async()=>{},crypto:{randomUUID:()=>crypto.randomUUID()},
    supabase:{rpc:async(name,args)=>{assert.equal(name,'app_operation');calls.push(args);return {error:null};}},
  };
  const lifecycle=actualHandler('inventory-catalog.tsx','InventoryCatalog','lifecycle',scope);
  await lifecycle('REMOVE',['p']);await lifecycle('RESTORE',['p']);
  await actualHandler('inventory-catalog.tsx','InventoryCatalog','reactivate',scope)('p');
  assert.deepEqual(calls.map(row=>[row.p_action,row.p_data.mode]),[
    ['count.catalog-lifecycle','REMOVE'],['count.catalog-lifecycle','RESTORE'],['product.lifecycle','RESTORE'],
  ]);
});
test('actual product editing never submits a deactivation state, while supplier editing preserves it',async()=>{
  for(const product of [true,false]){
    let saved;
    const scope={product,draft:{id:'p',name:'米',is_active:false,aliases:'白米、食材',safety_quantity:''},
      operation:{run:async(action,payload)=>{saved={action,payload};return {}; }},clearDraft:()=>{},setNotice:()=>{},setPage:()=>{},workspace:{refresh:async()=>{}},
    };
    await actualHandler('catalog-workspace.tsx','CatalogWorkspace','save',scope)();
    assert.equal(saved.action,product?'product.save':'supplier.save');
    assert.equal(Object.hasOwn(saved.payload,'is_active'),!product);
    if(!product)assert.equal(saved.payload.is_active,false);
  }
});
test('actual receipt options use the store-scoped basic-products section',async()=>{
  let products=[];let request;
  const allowed=[{id:'p',name:'米',base_unit:'袋',specification:null}];
  const scope={storeId:'store-a',setLoading:()=>{},setError:message=>{assert.equal(message,'');},setProducts:value=>{products=value;},receiptError:error=>error.message,
    supabase:{rpc:async(name,args)=>{request={name,args};return {data:{products:allowed},error:null};}},
  };
  await actualHandler('receipt-card-editor.tsx','ReceiptCardEditor','loadProducts',scope)();
  assert.equal(request.name,'app_workspace');assert.equal(request.args.p_section,'product-options');assert.equal(request.args.p_store_id,'store-a');
  assert.deepEqual(products,allowed);
});
