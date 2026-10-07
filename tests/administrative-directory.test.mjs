import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAdministrativeImport,validateAdministrativeRows,safeAdministrativeLink} from '../lib/administrative-directory.ts';
const row={id:'one',name:'租約',category:'合約文件',summary:'',link:'',note:'',archived:true,revision:2};
test('import preserves existing and archived identities, normalizes duplicates and never writes itself',()=>{
 const result=prepareAdministrativeImport([{'資料名稱':' 租約 '},{'資料名稱':'新資料'},{'資料名稱':'新資料'},{'資料名稱':''}], [row],()=> 'new');
 assert.equal(result.skipped,3);assert.deepEqual(result.rows.map(r=>r.name),['新資料']);assert.equal(row.archived,true);assert.equal(row.revision,2);
 assert.equal(prepareAdministrativeImport([{'資料名稱':'新資料'}],[...result.rows,row],()=> 'retry').rows.length,0);
});
test('partial information saves, unsafe links and oversized batches do not',()=>{
 assert.equal(validateAdministrativeRows([{...row,archived:false}]),'');
 assert.ok(validateAdministrativeRows([{...row,link:'javascript:alert(1)'}]));
 assert.ok(validateAdministrativeRows(Array(501).fill(row)));
 assert.equal(safeAdministrativeLink('data:text/html,test'),null);
 assert.equal(safeAdministrativeLink('https://example.com/a'),'https://example.com/a');
});
