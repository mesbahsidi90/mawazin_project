import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../server/worker.js';
import {defaultSettings} from '../dist/domain.js';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_big_molecule_man.sql',import.meta.url),'utf8'));
  const DB={prepare(sql) {
    const stmt=sqlite.prepare(sql);let args=[];
    return {bind(...values){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};}};
  }};
  const worker=createWorker({'/index.html':{body:'shell',type:'text/html'}});
  const call=async(path,method='GET',body,owner='alice',origin='https://example.test')=>{
    const headers={'Content-Type':'application/json',origin};if(owner)headers['oai-authenticated-user-id']=owner;
    return worker.fetch(new Request('https://example.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB});
  };
  return {sqlite,worker,call};
}
const record={id:'rec-one',timestamp:'2026-01-04T10:00:00Z',food:'rice',stage:'buffet',reason:'overproduction',meal:'lunch',weight:2.5,source:'manual'};
test('unauthenticated API and cross-origin writes denied',async()=>{
  const {sqlite,call}=fixture();
  assert.equal((await call('/api/records','GET',null,null)).status,401);
  assert.equal((await call('/api/records','POST',record,'alice','https://evil.test')).status,403);sqlite.close();
});
test('idempotent retries and isolation between accounts',async()=>{
  const {sqlite,call}=fixture();
  const a=await (await call('/api/records','POST',record)).json();
  const b=await (await call('/api/records','POST',{...record,weight:8})).json();
  assert.deepEqual(a,b);assert.equal(a.record.cost,650);
  const mine=await (await call('/api/records')).json();assert.equal(mine.records.length,1);
  const other=await (await call('/api/records','GET',null,'bob')).json();assert.equal(other.records.length,0);sqlite.close();
});
test('optimistic settings concurrency and historical pricing',async()=>{
  const {sqlite,call}=fixture();
  await call('/api/records','POST',record);
  const settings={...defaultSettings,unitPrices:{...defaultSettings.unitPrices,rice:500}};
  assert.equal((await call('/api/settings','PUT',{settings,revision:0})).status,200);
  assert.equal((await call('/api/settings','PUT',{settings,revision:0})).status,409);
  const old=await (await call('/api/records','POST',record)).json();assert.equal(old.record.cost,650);
  const fresh=await (await call('/api/records','POST',{...record,id:'rec-two'})).json();assert.equal(fresh.record.cost,1250);sqlite.close();
});
test('invalid API input rejected, server failures recoverable',async()=>{
  const {sqlite,call,worker}=fixture();assert.equal((await call('/api/records','POST',{...record,weight:-5})).status,400);
  const response=await worker.fetch(new Request('https://example.test/api/records',{headers:{'oai-authenticated-user-id':'alice'}}),{});
  assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');sqlite.close();
});
test('record pagination does not truncate',async()=>{
  const {sqlite,call}=fixture();
  const insert=sqlite.prepare('INSERT INTO waste_records (owner,id,timestamp,food,stage,reason,meal,grams,unit_cost,cost,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<501;i++)insert.run('alice','r-'+i,record.timestamp,'rice','buffet','overproduction','lunch',1000,260,260,'manual');
  const first=await (await call('/api/records')).json();assert.equal(first.records.length,500);
  const second=await (await call('/api/records?cursor='+first.nextCursor)).json();assert.equal(second.records.length,1);assert.equal(second.nextCursor,null);sqlite.close();
});
