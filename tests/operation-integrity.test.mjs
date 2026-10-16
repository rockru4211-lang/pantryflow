import test from 'node:test';import assert from 'node:assert/strict';
import {operationProduct,operationRecordStatus} from '../lib/operation-integrity.ts';
const products=[{id:'flour',name:'麵粉',base_unit:'公斤'},{id:'wine',name:'Wine A',base_unit:'瓶'}];
test('only a unique exact name with an equivalent unit can link an operation',()=>{
 assert.equal(operationProduct(products,' 麵粉 ','kg')?.id,'flour');assert.equal(operationProduct(products,'Ｗｉｎｅ Ａ','瓶')?.id,'wine');
 assert.equal(operationProduct(products,'麵粉','克'),null);assert.equal(operationProduct(products,'高筋麵粉','公斤'),null);assert.equal(operationProduct(products,'麵粉',''),null);
 assert.equal(operationProduct([...products,{id:'other',name:'麵粉',base_unit:'kg'}],'麵粉','公斤'),null);
 assert.equal(operationProduct([...products,products[0]],'麵粉','公斤')?.id,'flour');
});
test('price or confirmation never implies a missing product has been linked',()=>{
 assert.equal(operationRecordStatus({review_status:'CONFIRMED',product_id:null}),'已確認・待對應食材');
 assert.equal(operationRecordStatus({review_status:'PENDING',product_id:'flour'}),'待確認');
 assert.equal(operationRecordStatus({review_status:'PENDING'}),'待確認・待對應食材');
});
