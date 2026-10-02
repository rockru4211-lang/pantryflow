import test from 'node:test';
import assert from 'node:assert/strict';
import {transferDirections, selectedTransferDirection, sourceTransferProducts} from '../lib/transfer-direction.ts';
const first = {id: 'first', name: 'BeApe'};
const second = {id: 'second', name: 'Gras'};
const directions = transferDirections(first, [second]);

test('both recording stores see the same two explicit directions', () => {
  assert.deepEqual(transferDirections(second, [first]), directions);
  assert.deepEqual(directions.map(d => d.label), ['一店 BeApe → 二店 Gras', '二店 Gras → 一店 BeApe']);
  assert.deepEqual(directions.map(d => [d.from_store_id, d.to_store_id]), [['first', 'second'], ['second', 'first']]);
});
test('duplicate IDs are deduplicated and unrelated peer names are not offered', () => {
  assert.deepEqual(transferDirections(first, [first, second, second, {id: 'qa', name: '測試門市'}]), directions);
});
test('missing, ambiguous or unrelated stores do not produce a guessed direction', () => {
  assert.deepEqual(transferDirections(first, []), []);
  assert.deepEqual(transferDirections(first, [second, {id: 'extra', name: 'Gras'}]), []);
  assert.deepEqual(transferDirections({id: 'qa', name: '測試門市'}, [first, second]), []);
});
test('fresh drafts have no default direction', () => {
  assert.equal(selectedTransferDirection(directions, {from_store_id: '', to_store_id: ''}, second.id), undefined);
});
test('an old saved outbound draft retains its original direction', () => {
  assert.equal(selectedTransferDirection(directions, {to_store_id: first.id}, second.id)?.id, 'gras-to-beape');
});
test('an explicit inbound source is never overwritten by the recording store', () => {
  assert.equal(selectedTransferDirection(directions, {from_store_id: first.id, to_store_id: second.id}, second.id)?.id, 'beape-to-gras');
  assert.equal(selectedTransferDirection(directions, {from_store_id: second.id, to_store_id: first.id}, first.id)?.id, 'gras-to-beape');
});
test('explicit blank, same-store and invalid draft directions stay invalid', () => {
  for (const draft of [
    {from_store_id: '', to_store_id: second.id},
    {from_store_id: first.id, to_store_id: first.id},
    {from_store_id: 'foreign', to_store_id: second.id},
  ]) assert.equal(selectedTransferDirection(directions, draft, first.id), undefined);
});
test('source-only catalog excludes removed items and never substitutes destination products', () => {
  const a = {id: 'ham', name: '火腿', unit: '公斤'};
  const b = {id: 'wine', name: '酒', unit: '瓶'};
  const catalogs = [
    {store_id: first.id, products: [a, {id: 'removed', name: '已移除', unit: '包', available_for_transfer: false}]},
    {store_id: second.id, products: [b]},
  ];
  assert.deepEqual(sourceTransferProducts(catalogs, first.id), [a]);
  assert.deepEqual(sourceTransferProducts(catalogs, second.id), [b]);
  assert.deepEqual(sourceTransferProducts(catalogs, 'foreign'), []);
  assert.deepEqual(sourceTransferProducts(catalogs, undefined), []);
  assert.deepEqual(sourceTransferProducts(undefined, first.id), []);
});
