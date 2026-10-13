import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentChoices,repairVendor,withRepairVendor,selectRepairEquipment} from '../lib/equipment-selection.ts';
const row=(id,name,other={})=>({id,name,category:'維修紀錄',summary:'',link:'',note:'',archived:false,revision:0,...other});
test('repair selection deduplicates names and excludes removed directory names and unrelated contracts',()=>{
 const rows=[row('1','冰箱'),row('2','冰箱'),row('3','冷氣',{category:'設備資料',archived:true}),row('4','冷氣'),row('5','租約',{category:'合約文件'}),row('6','甲廠商',{category:'設備資料',summary:'服務事項：冷凍維修'})];
 assert.deepEqual(equipmentChoices(rows).names,['冰箱']);
 assert.deepEqual(equipmentChoices(rows).vendors,['甲廠商']);
});
test('latest repair vendor prefills without copying old repair content or overriding manual choice',()=>{
 const draft=row('new','',{summary:'原有備註'}),history=[row('a','冰箱',{repair_date:'2025-01-01',summary:'維修廠商：甲'}),row('b','冰箱',{repair_date:'2026-01-01',summary:'維修廠商：乙\n舊內容'})];
 const selected=selectRepairEquipment(draft,'冰箱',history);
 assert.equal(selected.summary,'維修廠商：乙\n原有備註');
 assert.equal(selectRepairEquipment({...draft,summary:'維修廠商：手動'},'冰箱',history).summary,'維修廠商：手動');
 assert.equal(selectRepairEquipment(draft,'冰箱',[...history,row('v','乙',{category:'設備資料',is_removed:true})]).summary,'原有備註');
 assert.equal(withRepairVendor(selected.summary,''),'原有備註');
 assert.equal(repairVendor(withRepairVendor(selected.summary,'丙')),'丙');
});
