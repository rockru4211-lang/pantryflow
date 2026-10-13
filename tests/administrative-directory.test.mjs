import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentContact,updateEquipmentContact,prepareAdministrativeImport,validateAdministrativeRows,safeAdministrativeLink} from '../lib/administrative-directory.ts';
const row={id:'one',name:'租約',category:'合約文件',summary:'',link:'',note:'',archived:true,revision:2};
test('equipment fields preserve multiline service, multiple contact methods and unlabelled history',()=>{
 const original='早期設備購入資料\n服務事項：冷氣維修\n每年保養\n聯絡人：廖先生\n電話：0937-089114\n02-12345678\n聯絡方式：官方 LINE';
 const parts=equipmentContact(original);
 assert.equal(parts.service,'冷氣維修\n每年保養');assert.equal(parts.phone,'0937-089114\n02-12345678');
 assert.equal(parts.details,'早期設備購入資料');
 const changed=updateEquipmentContact(original,'contact','新窗口');
 assert.deepEqual(equipmentContact(changed),{...parts,contact:'新窗口'});
 assert.deepEqual(equipmentContact(updateEquipmentContact(changed,'phone','')),{...parts,contact:'新窗口',phone:''});
 assert.equal(equipmentContact(updateEquipmentContact('','method','加官方 LINE')).method,'加官方 LINE');
});
test('split equipment columns import and retry without losing legacy summary or source link',()=>{
 const values=[{'資料名稱':'維修公司','分類':'設備資料','內容摘要':'購買年份未知','服務事項':'冷氣\n保養','聯絡人':'陳先生','電話':'0912-345678','聯絡方式':'LINE 群組','附件／連結':'https://docs.google.com/spreadsheets/d/example','備註':'需提前預約'}];
 const result=prepareAdministrativeImport(values,[],()=> 'equipment');
 assert.deepEqual(equipmentContact(result.rows[0].summary),{service:'冷氣\n保養',contact:'陳先生',phone:'0912-345678',method:'LINE 群組',details:'購買年份未知'});
 assert.equal(result.rows[0].note,'需提前預約');assert.equal(result.rows[0].link,values[0]['附件／連結']);
 assert.equal(prepareAdministrativeImport(values,result.rows,()=> 'retry').rows.length,0);
});
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

const {contractReminderDate,contractDue}=await import('../lib/administrative-directory.ts');
test('contract reminder uses calendar months and clamps month-end including leap years',()=>{
 assert.equal(contractReminderDate('2026-12-31'),'2026-09-30');
 assert.equal(contractReminderDate('2027-05-31'),'2027-02-28');
 assert.equal(contractReminderDate('2028-05-31'),'2028-02-29');
 const contract={...row,archived:false,contract_end:'2026-12-31'};
 assert.equal(contractDue(contract,'2026-09-29'),false);
 assert.equal(contractDue(contract,'2026-09-30'),true);
 assert.equal(contractDue({...contract,archived:true},'2026-10-12'),false);
 assert.equal(contractDue({...contract,contract_end:null},'2026-10-12'),false);
 assert.equal(contractDue({...contract,category:'設備資料'},'2026-10-12'),false);
});
test('renewal clears due status; missing dates remain saveable; date order is validated',()=>{
 assert.equal(contractDue({...row,archived:false,contract_end:'2027-12-31'},'2026-10-12'),false);
 assert.equal(validateAdministrativeRows([{...row,contract_end:null}]),'');
 assert.ok(validateAdministrativeRows([{...row,contract_start:'2026-12-31',contract_end:'2026-01-01'}]));
});
test('repair imports retain separate visits for one equipment and skip exact repeated records',()=>{
 const values=[{'資料名稱':'製冰機','分類':'維修紀錄','維修日期':'2026-10-01','維修原因':'漏水','處理結果':'更換水管'},{'資料名稱':'製冰機','分類':'維修紀錄','維修日期':'2026-10-12','維修原因':'無法製冰','處理結果':'更換水泵'}];
 const result=prepareAdministrativeImport([...values,values[0]],[],()=>crypto.randomUUID());
 assert.equal(result.rows.length,2);assert.equal(result.skipped,1);
 assert.equal(prepareAdministrativeImport(values,result.rows,()=>crypto.randomUUID()).rows.length,0);
});
