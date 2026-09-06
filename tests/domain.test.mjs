import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,validateRecord,validateSettings,dayKey,filterRecords,csvText,escapeHtml} from '../dist/domain.js';
const record={id:'test-1',timestamp:'2026-01-03T23:30:00Z',food:'chicken',stage:'surplus',reason:'overproduction',meal:'lunch',weight:3.25,source:'manual',note:'test'};
test('cost calculated from validated price, not submitted cost',()=>{
  const r=validateRecord({...record,cost:1,unitCost:1});assert.equal(r.cost,2015);assert.equal(r.unitCost,620);
});
test('reject non-finite, zero, oversized, invalid enum and future data',()=>{
  for(const bad of [{weight:NaN},{weight:Infinity},{weight:0},{weight:21},{food:'__proto__'},{source:'operator'},{timestamp:'bad'},{timestamp:'2999-01-01'},{id:'x<script>'}]) assert.throws(()=>validateRecord({...record,...bad}));
});
test('Algeria day boundary and inclusive date filtering',()=>{
  assert.equal(dayKey(record.timestamp),'2026-01-04');
  assert.equal(filterRecords([record],{start:'2026-01-04',end:'2026-01-04',source:'manual'}).length,1);
  assert.equal(filterRecords([record],{source:'simulator'}).length,0);
});
test('settings validate prices and preserve zeros',()=>{
  assert.equal(validateSettings({...defaultSettings,dailyTarget:0}).dailyTarget,0);
  assert.throws(()=>validateSettings({...defaultSettings,unitPrices:{rice:-1}}));
});
test('CSV formula protection, escaping and UTF-8 BOM',()=>{
  const value=csvText([['=SUM(A1)','a"b','مرحبا','@evil']]);
  assert.ok(value.startsWith('\ufeff'));assert.ok(value.includes("'=SUM(A1)"));assert.ok(value.includes('a""b'));assert.ok(value.includes("'@evil"));
  assert.equal(escapeHtml('<script>'),'&lt;script&gt;');
});
