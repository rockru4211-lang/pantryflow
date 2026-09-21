import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createInventoryImportPreparationCache,runInventoryImportQueue,replaceImportedFile} from '../lib/inventory-import-queue.ts';
import {importRecoveryMessage,isImportModuleLoadError,importModuleLoadMessage} from '../lib/inventory-import-errors.ts';
import {catalogStates} from '../lib/inventory-import-status.ts';

const source=readFileSync(new URL('../app/pilot/inventory-import-flow.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('inventory-import-flow.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const flow=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='InventoryImportFlow');
assert.ok(flow?.body,'Exercise the actual import component');
const buildNode=flow.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='build');
assert.ok(buildNode,'Exercise the actual import build handler');
const buildCode=ts.transpileModule(buildNode.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function handler(name,scope){
  const node=flow.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.ok(node,`Exercise the actual ${name} handler`);
  const code=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(code,scope,{timeout:1000});
  return scope[name];
}
function initializer(name){
  for(const node of flow.body.statements){
    if(!ts.isVariableStatement(node))continue;
    const declaration=node.declarationList.declarations.find(item=>item.name.getText(ast)===name);
    if(declaration?.initializer)return declaration.initializer.getText(ast);
  }
  throw Error(`Missing initializer: ${name}`);
}

function buildHarness(options={}){
  const meta={id:'file-wine',original_filename:'酒類.xlsx',file_sha256:'wine-hash',storage_path:'org/store/wine',sheet_names:['酒類']};
  const review=[
    {sourceId:'酒類:2',name:'紅酒',unit:'瓶',zoneName:'吧台',quantityText:'3',status:'PENDING'},
    {sourceId:'酒類:3',name:'白酒',unit:'瓶',zoneName:'吧台',quantityText:'2',status:'PENDING'},
  ];
  const persistedRows=options.partial?[{sourceId:'酒類:2',productId:'red-wine'}]:[
    {sourceId:'酒類:2',productId:'red-wine'},{sourceId:'酒類:3',productId:'white-wine'},
  ];
  const events=[];
  const visibleRows=[];
  const scope={
    storeId:'store-beape',
    canBuild:row=>Boolean(row.name.trim()),
    reviewPayload:row=>row,
    importRecoveryMessage,
    filesRef:{current:[]},
    rpcAny:async(name,args)=>{
      events.push(name);
      assert.equal(args.p_store_id,'store-beape');
      if(name==='import_pilot_inventory_quick'){
        assert.deepEqual(Array.from(args.p_rows.rows,row=>row.sourceId),['酒類:2','酒類:3']);
        return {data:options.importRows??(options.partial?[{status:'ADDED'},{status:'FAILED'}]:[{status:'ADDED'},{status:'ADDED'}]),error:options.importError??null};
      }
      assert.equal(name,'sync_active_count_after_import','Import must never start a count automatically');
      return {data:null,error:options.syncError??null};
    },
    supabase:{from:table=>{
      assert.equal(table,'inventory_import_files');
      const query={
        select:()=>query,
        eq:(column,value)=>{assert.equal(value,column==='store_id'?'store-beape':'wine-hash');return query;},
        is:(column,value)=>{assert.equal(column,'removed_at');assert.equal(value,null);return query;},
        single:async()=>{events.push('read-file');return {data:meta,error:options.fileError??null};},
      };
      return query;
    }},
    loadPersisted:async file=>{
      events.push('read-rows');assert.equal(file.id,meta.id);
      if(options.rowsError)throw options.rowsError;
      visibleRows.push(...persistedRows);
    },
    onStartCount:()=>assert.fail('Import must not activate the count callback'),
  };
  runInNewContext(buildCode,scope,{timeout:1000});
  return {events,visibleRows,files:scope.filesRef,run:()=>scope.build(review,meta)};
}

test('actual build reads back successful rows even when another row in the chunk fails',async()=>{
  const h=buildHarness({partial:true});
  await assert.rejects(h.run(),/部分品項尚未建立/);
  assert.deepEqual(h.events,['import_pilot_inventory_quick','read-file','read-rows']);
  assert.deepEqual(h.visibleRows,[{sourceId:'酒類:2',productId:'red-wine'}]);
  assert.equal(h.files.current[0].id,'file-wine','Partially imported file remains available to remove or retry');
});

test('actual build preserves its original write error if file or row readback also fails',async()=>{
  for(const readback of [{fileError:new Error('FILE_READBACK_FAILED')},{rowsError:new Error('ROW_READBACK_FAILED')}]){
    const h=buildHarness({importError:{message:'ORIGINAL_WRITE_FAILURE'},...readback});
    await assert.rejects(h.run(),error=>error.message==='ORIGINAL_WRITE_FAILURE');
    assert.ok(h.events.includes('read-file'),'Readback is still attempted after the write failure');
  }
});

test('actual successful build reads back imports without starting a count',async()=>{
  const h=buildHarness();
  await h.run();
  assert.deepEqual(h.events,['import_pilot_inventory_quick','sync_active_count_after_import','read-file','read-rows']);
  assert.equal(h.visibleRows.length,2);
});

test('actual build preserves imported rows when count synchronization fails',async()=>{
  const h=buildHarness({syncError:{message:'COUNT_SYNC_FAILED'}});
  await assert.rejects(h.run(),error=>error.message==='COUNT_SYNC_FAILED');
  assert.deepEqual(h.events,['import_pilot_inventory_quick','sync_active_count_after_import','read-file','read-rows']);
  assert.equal(h.visibleRows.length,2,'Already saved products remain visible even when count refresh fails');
});

const recoveryCases=[
  ['IMPORT_REMOVED_REVIEW_REQUIRED','此檔案先前已移除，缺少可安全復原的紀錄；已停止匯入，請聯絡管理者處理。'],
  ['IMPORT_ROW_REMOVED_REVIEW_REQUIRED','部分品項曾被個別移除，已保留移除狀態；請先確認品項再重新匯入。'],
];
test('removed-import recovery errors have specific guidance across RPC error shapes',()=>{
  for(const [code,message] of recoveryCases){
    for(const error of [code,new Error(code),{message:code},new Error(`database: ${code}`)])assert.equal(importRecoveryMessage(error),message);
  }
  for(const error of [undefined,null,{},'NETWORK_ERROR',{message:'OCR_HTTP_429'},'IMPORT_REMOVED_REVIEW_REQUIRED_OTHER'])assert.equal(importRecoveryMessage(error),undefined);
});
test('actual build preserves recovery guidance from FAILED rows instead of generic retry text',async()=>{
  for(const [code,message] of recoveryCases){
    const h=buildHarness({importRows:[{status:'ADDED'},{status:'FAILED',reason:'temporary failure'},{status:'FAILED',reason:code}]});
    await assert.rejects(h.run(),error=>error.message===message);
    assert.ok(h.events.includes('read-rows'),'Saved rows are still recovered for review');
  }
});
test('actual queue displays recovery guidance for top-level RPC errors',async()=>{
  for(const [code,message] of recoveryCases){
    let queue=[];
    const scope={busy:false,disabled:false,loading:false,processingRef:{current:false},needsReload:false,
      setBusy:()=>{},setScreen:()=>{},setNotice:()=>{},setNeedsReload:()=>assert.fail('Data recovery must not request a module reload'),
      runInventoryImportQueue,importFile:async()=>{throw new Error(code);},setQueue:next=>{queue=next;},
      isImportModuleLoadError,importModuleLoadMessage,importRecoveryMessage,appError:error=>error.message,onImported:async()=>{},
    };
    await handler('processQueue',scope)([{id:'one',file:new File(['data'],'盤點.xlsx'),status:'pending'}]);
    assert.equal(queue[0].status,'failed');
    assert.equal(queue[0].error,message);
    assert.equal(scope.processingRef.current,false);
  }
});

function persistedHarness(options={}){
  let items=[];
  const sourceRows=[
    {source_id:'酒類:2',sheet_name:'酒類',source_row:2,product_id:'red',status:'ADDED',raw_values:{}},
    {source_id:'酒類:3',sheet_name:'酒類',source_row:3,product_id:'white',status:'EXISTING',raw_values:{}},
  ];
  const products=[
    {id:'red',name:'紅酒',count_unit:'瓶',specification:null,updated_at:'now',is_active:false},
    {id:'white',name:'白酒',count_unit:'瓶',specification:null,updated_at:'now',is_active:true},
  ];
  const scope={storeId:'store-beape',replaceImportedFile,catalogStates,setBuiltItems:update=>{items=update(items);},
    restoreReviewRows:records=>records.map(row=>({sourceId:row.source_id,zoneName:'吧台',quantityText:'3'})),
    supabase:{rpc:async(name,args)=>{
      assert.equal(name,'get_pilot_inventory_catalog');assert.equal(args.p_store_id,'store-beape');
      return {data:options.catalog??[
        {product_id:'red',catalog_state:'DISABLED',product_is_active:false,is_removed:false,is_configured:true},
        {product_id:'white',catalog_state:'ACTIVE',product_is_active:true,is_removed:false,is_configured:true},
      ],error:null};
    },from:table=>{
      const query={
        select:columns=>{if(table==='products')assert.ok(columns.split(',').includes('is_active'));return query;},
        eq:()=>query,order:()=>query,
        limit:async()=>{assert.equal(table,'inventory_import_rows');return {data:sourceRows,error:null};},
        in:async()=>{assert.equal(table,'products');return {data:products,error:options.productError??null};},
      };return query;
    }},
  };
  const file={id:'wine',file_sha256:'wine-hash',sheet_names:['酒類']};
  return {scope,run:()=>handler('loadPersisted',scope)(file),get items(){return items;}};
}
test('actual persisted-import loading keeps inactive products out of the ready list',async()=>{
  const h=persistedHarness();await h.run();
  assert.equal(h.items[0].isActive,false);
  assert.equal(h.items[0].reason,'品項已停用，未列入盤點');
  const scope={builtItems:h.items};
  const code=ts.transpileModule(`globalThis.needsFix=(${initializer('needsFix')});globalThis.ready=(${initializer('ready')});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,scope,{timeout:1000});
  assert.deepEqual(Array.from(scope.ready,row=>row.productId),['white']);
});
test('actual persisted-import loading does not silently assume products are active after a query failure',async()=>{
  const h=persistedHarness({productError:new Error('PRODUCT_STATUS_UNAVAILABLE')});
  await assert.rejects(h.run(),/PRODUCT_STATUS_UNAVAILABLE/);
  assert.equal(h.items.length,0);
});
test('actual persisted loading distinguishes removed products and unknown status from active products',async()=>{
  const h=persistedHarness({catalog:[{product_id:'red',catalog_state:'REMOVED',product_is_active:false,is_removed:true,is_configured:false}]});
  await h.run();
  assert.equal(h.items[0].reason,'品項已從本店移除');
  assert.equal(h.items[0].catalogState,'REMOVED');
  assert.equal(h.items[1].catalogState,'UNKNOWN');
  assert.match(h.items[1].reason,/狀態尚未確認/);
  const scope={builtItems:h.items};
  const code=ts.transpileModule(`globalThis.countableItems=(${initializer('countableItems')});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,scope,{timeout:1000});
  assert.equal(scope.countableItems.length,0);
});
test('actual item editing preserves an inactive product warning instead of implying reactivation',async()=>{
  const h=persistedHarness();await h.run();
  let items=h.items;
  const scope={selected:items[0],busy:false,storeId:'store-beape',editDraft:{name:'紅酒新名稱',unit:'瓶',quantity:'4',specification:'750ml',zone:'吧台'},
    setNotice:()=>{},setBusy:()=>{},setScreen:()=>{},setSelected:updated=>{scope.selected=updated;},
    setBuiltItems:update=>{items=update(items);},onImported:async()=>{},appError:error=>error.message,
    rpcAny:async(name,args)=>{assert.equal(name,'update_imported_inventory_item');assert.equal(args.p_product_id,'red');return {data:null,error:null};},
  };
  await handler('saveItem',scope)();
  assert.equal(items[0].name,'紅酒新名稱');
  assert.equal(items[0].isActive,false);
  assert.equal(items[0].reason,'品項已停用，未列入盤點');
  assert.equal(scope.selected.reason,'品項已停用，未列入盤點');
});

test('a failed save retries the same recognized rows without running OCR again',async()=>{
  const cache=createInventoryImportPreparationCache();
  const file=new File(['scan'],'酒類.pdf');
  const entries=[{id:'wine',file,status:'pending'}];
  const rows=[{sourceId:'vision:1:2:0:吧台',name:'紅酒',zoneName:'吧台'}];
  let recognitionCalls=0;
  let saveCalls=0;
  const received=[];
  const process=async()=>{
    const prepared=await cache.getOrPrepare('wine-content-hash',async()=>{
      recognitionCalls++;
      return {rows,sheetNames:['第 1 頁']};
    });
    received.push(prepared);
    if(++saveCalls===1)throw Error('暫時無法儲存');
  };
  const failed=await runInventoryImportQueue(entries,process,()=>{},error=>error.message);
  assert.equal(failed[0].status,'failed');
  assert.equal(failed[0].error,'暫時無法儲存');
  const retried=await runInventoryImportQueue(failed,process,()=>{},error=>error.message);
  assert.equal(retried[0].status,'done');
  assert.equal(saveCalls,2);
  assert.equal(recognitionCalls,1);
  assert.strictEqual(received[0],received[1],'source IDs and sheet metadata stay stable across retries');
  assert.deepEqual(received[1],{rows,sheetNames:['第 1 頁']});
});

test('failed recognition is not cached and an explicit retry can recover',async()=>{
  const cache=createInventoryImportPreparationCache();
  let calls=0;
  const recognize=async()=>{
    if(++calls===1)throw Error('辨識未完成');
    return [{name:'鮮奶'}];
  };
  await assert.rejects(cache.getOrPrepare('photo',recognize),/辨識未完成/);
  assert.deepEqual(await cache.getOrPrepare('photo',recognize),[{name:'鮮奶'}]);
  assert.equal(calls,2);
});

test('identical content shares preparation while changed files and other stores do not',async()=>{
  const firstStore=createInventoryImportPreparationCache();
  const otherStore=createInventoryImportPreparationCache();
  let calls=0;
  const prepare=async()=>({recognition:++calls});
  const sameContent=await Promise.all([
    firstStore.getOrPrepare('contents-a',prepare),
    firstStore.getOrPrepare('contents-a',prepare),
  ]);
  assert.strictEqual(sameContent[0],sameContent[1]);
  const changedFile=await firstStore.getOrPrepare('contents-b',prepare);
  const otherStoreFile=await otherStore.getOrPrepare('contents-a',prepare);
  assert.equal(calls,3);
  assert.notStrictEqual(changedFile,sameContent[0]);
  assert.notStrictEqual(otherStoreFile,sameContent[0]);
});

test('a preparation that throws synchronously can also be retried',async()=>{
  const cache=createInventoryImportPreparationCache();
  await assert.rejects(cache.getOrPrepare('broken',()=>{throw Error('檔案內容不完整');}),/檔案內容不完整/);
  assert.equal(await cache.getOrPrepare('broken',async()=>'ready'),'ready');
});
