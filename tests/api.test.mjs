import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../server/worker.js';
import {defaultSettings} from '../dist/domain.js';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const DB={prepare(sql) {
    const stmt=sqlite.prepare(sql);let args=[];
    return {bind(...values){args=values;return this;},async first(){return stmt.get(...args)??null;},async all(){return {results:stmt.all(...args)};},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};}};
  },async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  for(const owner of ['alice','bob'])sqlite.prepare('INSERT INTO kitchens (id,owner,created_at) VALUES (?,?,?)').run('k-'+owner,owner,new Date().toISOString());
  for(const owner of ['alice','bob']){
    sqlite.prepare('INSERT INTO manager_accounts VALUES (?,?,?,?,?)').run(owner,owner+'@test.example','unused','unused','v1');
    sqlite.prepare('INSERT INTO manager_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(owner).digest('hex'),owner,'v1',Date.now()+1000000);
  }
  const worker=createWorker({'/index.html':{body:'shell',type:'text/html'}});
  const call=async(path,method='GET',body,owner='alice',origin='https://example.test')=>{
    const headers={'Content-Type':'application/json',origin};if(owner){headers['oai-authenticated-user-id']=owner;headers.cookie='__Host-mawazin_manager='+owner;}
    return worker.fetch(new Request('https://example.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB});
  };
  return {sqlite,worker,call,DB};
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

test('catalog supports custom foods, preserves archived records and rejects removal',async()=>{
 const {sqlite,call}=fixture();
 const base=(await (await call('/api/settings')).json()).settings;
 const {defaultCatalog}=await import('../dist/domain.js');
 const settings={...base,catalog:{...defaultCatalog,couscous:{label:'كسكس',image:0,active:true,meals:['lunch']}},unitPrices:{...base.unitPrices,couscous:350}};
 assert.equal((await call('/api/settings','PUT',{settings,revision:0})).status,200);
 const saved=await (await call('/api/records','POST',{...record,food:'couscous'})).json();
 assert.equal(saved.record.cost,875);
 settings.catalog.couscous.active=false;
 assert.equal((await call('/api/settings','PUT',{settings,revision:1})).status,200);
 assert.equal((await (await call('/api/records','POST',{...record,food:'couscous'})).json()).record.cost,875);
 delete settings.catalog.couscous;delete settings.unitPrices.couscous;
 assert.equal((await call('/api/settings','PUT',{settings,revision:2})).status,400);
 assert.equal((await call('/api/records','POST',{...record,id:'unknown',food:'couscous'},'bob')).status,400);
 sqlite.close();
});
test('meal totals are isolated, revision checked and replaced instead of accumulated',async()=>{
 const {sqlite,call}=fixture();
 const service={date:'2026-01-04',meal:'lunch',meals:100,productionKg:50,revision:0};
 assert.equal((await call('/api/services','PUT',service)).status,200);
 assert.equal((await call('/api/services','PUT',service)).status,409);
 assert.equal((await call('/api/services','PUT',{...service,meals:120,revision:1})).status,200);
 const rows=(await (await call('/api/services')).json()).services;
 assert.equal(rows.length,1);assert.equal(rows[0].meals,120);
 assert.equal((await (await call('/api/services','GET',null,'bob')).json()).services.length,0);
 assert.equal((await call('/api/services','PUT',{...service,date:'2026-02-30'})).status,400);
 sqlite.close();
});

test('uploaded food images are private to their owner and require valid type',async()=>{
 const {sqlite,worker,DB}=fixture(),objects=new Map();
 const PHOTOS={async put(k,b){objects.set(k,b);},async get(k){return objects.has(k)?{body:objects.get(k)}:null;}};
 const req=(path,method,body,owner='alice',type='image/webp')=>worker.fetch(new Request('https://example.test'+path,{method,headers:{origin:'https://example.test','oai-authenticated-user-id':owner,'Content-Type':type,cookie:'__Host-mawazin_manager='+owner},...(body?{body}:{})}),{DB,PHOTOS});
 assert.equal((await req('/api/food-images','POST','not an image')).status,400);
 const bytes=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
 const upload=await (await req('/api/food-images','POST',bytes)).json();
 assert.ok(upload.photo);
 assert.equal((await req(upload.photo,'GET')).status,200);
 assert.equal((await req(upload.photo,'GET',null,'bob')).status,404);
 assert.equal((await req(upload.photo,'GET')).headers.get('Cache-Control'),'private, no-store');
 sqlite.close();
});
