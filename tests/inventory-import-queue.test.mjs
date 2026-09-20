import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseInventoryWorkbook,readInventoryWorkbook} from '../lib/inventory-import.ts';
import {runInventoryImportQueue,replaceImportedFile} from '../lib/inventory-import-queue.ts';

const entry=(file,id=file.name)=>({id,file,status:'pending'});
const errorMessage=error=>error.message;
function workbookFile(name,product){
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ['品名','單位','期初數量'],[product,'瓶',3],
  ]),'盤點表');
  return new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],name);
}

test('two selected Excel files with the same sheet and row remain separate imports',async()=>{
  const entries=[entry(workbookFile('內場.xlsx','鮮奶')),entry(workbookFile('外場.xlsx','紅酒'))];
  let imported=[];
  const result=await runInventoryImportQueue(entries,async file=>{
    const parsed=parseInventoryWorkbook(readInventoryWorkbook(await file.arrayBuffer(),file.name));
    imported=replaceImportedFile(imported,file.name,parsed.rows.map(row=>({...row,file:{file_sha256:file.name}})));
  },()=>{},errorMessage);
  assert.deepEqual(result.map(row=>row.status),['done','done']);
  assert.deepEqual(imported.map(row=>row.name),['鮮奶','紅酒']);
  assert.equal(imported[0].sourceId,imported[1].sourceId,'fixture exercises overlapping source IDs');
});

test('a failed middle file does not block later files and retry skips successes',async()=>{
  const files=['內場.xlsx','失敗.pdf','外場.xlsx'].map(name=>entry(new File(['data'],name)));
  const calls=[];const snapshots=[];let active=0;let fail=true;
  const process=async file=>{
    active++;assert.equal(active,1,'uploads and OCR must be sequential');calls.push(file.name);
    try{await new Promise(resolve=>setImmediate(resolve));if(file.name==='失敗.pdf'&&fail)throw Error('暫時失敗');}
    finally{active--;}
  };
  const result=await runInventoryImportQueue(files,process,next=>snapshots.push(next),errorMessage);
  assert.deepEqual(result.map(row=>row.status),['done','failed','done']);
  assert.deepEqual(snapshots[0].map(row=>row.status),['processing','pending','pending'],'published snapshots must not mutate');
  assert.equal(result[1].error,'暫時失敗');
  fail=false;
  const retried=await runInventoryImportQueue(result,process,()=>{},errorMessage);
  assert.deepEqual(calls,['內場.xlsx','失敗.pdf','外場.xlsx','失敗.pdf']);
  assert.ok(retried.every(row=>row.status==='done'&&!row.error));
});

test('same filenames do not silently discard different files',async()=>{
  const files=[entry(new File(['A'],'盤點.xlsx'),'one'),entry(new File(['B'],'盤點.xlsx'),'two')];
  const content=[];
  await runInventoryImportQueue(files,async file=>{content.push(await file.text());},()=>{},errorMessage);
  assert.deepEqual(content,['A','B']);
});

test('retry or removal changes only its file even when both files use the same source ID',()=>{
  const a={sourceId:'盤點表:2',name:'A',file:{file_sha256:'a'}};
  const b={sourceId:'盤點表:2',name:'B',file:{file_sha256:'b'}};
  const current=[a,b];
  const updated=replaceImportedFile(current,'b',[{...b,name:'B corrected'}]);
  assert.equal(updated.length,2);
  assert.deepEqual(updated.map(row=>row.name),['A','B corrected']);
  assert.deepEqual(replaceImportedFile(updated,'b',[]),[a]);
  assert.deepEqual(current,[a,b],'input is not mutated');
});
