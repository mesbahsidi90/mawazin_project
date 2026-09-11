import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../server/worker.js';
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const worker=createWorker(),env={DB,ADMIN_SETUP_HASH:await hash('test-setup')};
 const cookies=new Map();
 const call=(path,method='GET',body,actor='admin',cookie)=>worker.fetch(new Request('https://example.test'+path,{method,headers:{origin:'https://example.test','Content-Type':'application/json',...(actor?{'oai-authenticated-user-id':actor}:{}),...((cookie||cookies.get(actor))?{cookie:cookie||cookies.get(actor)}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
 const data=async(...args)=>{const r=await call(...args);assert.ok(r.ok,await r.clone().text());if(r.headers.has('set-cookie'))cookies.set(args[3]||'admin',r.headers.get('set-cookie').split(';')[0]);return r.json();};
 return {sqlite,call,data,cookies};
}
test('admin setup is pinned; kitchen creation is admin-only; claims preserve kitchen isolation',async()=>{
 const {sqlite,call,data}=await fixture();
 assert.equal((await call('/api/admin/kitchens','POST',{name:'غير مصرح'})).status,403);
 assert.equal((await call('/api/admin/setup','POST',{code:'bad'})).status,403);
 await data('/api/admin/setup','POST',{code:'test-setup'});
 assert.equal((await call('/api/admin/setup','POST',{code:'test-setup'},'attacker')).status,403);
 const {kitchen}=await data('/api/admin/kitchens','POST',{name:'مطبخ ألف'});
 const second=(await data('/api/admin/kitchens','POST',{name:'مطبخ باء'})).kitchen;
 assert.equal((await call('/api/settings','GET',null,'new')).status,401);
 assert.equal((await call('/api/session','GET',null,'new')).status,401);
 const invite=await data('/api/admin/invites','POST',{kitchenId:kitchen.id});
 assert.equal(sqlite.prepare('SELECT hash FROM manager_invites').get().hash,await hash(invite.code));
 await data('/api/auth/activate','POST',{code:invite.code,email:'manager@test.example',password:'a long test password'},'manager');
 assert.equal((await data('/api/kitchen','GET',null,'manager')).kitchen.name,'مطبخ ألف');
 assert.equal((await call('/api/auth/activate','POST',{code:invite.code,email:'other@test.example',password:'a long test password'},'other')).status,400);
 assert.equal((await call('/api/kitchen','POST',{},'manager')).status,403);
 assert.equal((await call('/api/admin/kitchens','POST',{name:'اختراق'},'manager')).status,403);
 const another=await data('/api/admin/invites','POST',{kitchenId:second.id});
 assert.equal((await call('/api/auth/activate','POST',{code:another.code,email:'manager@test.example',password:'a long test password'},'manager')).status,409);
 sqlite.prepare('UPDATE manager_invites SET expires_at=0 WHERE hash=?').run(await hash(another.code));
 assert.equal((await call('/api/auth/activate','POST',{code:another.code,email:'other@test.example',password:'a long test password'},'other')).status,400);
 sqlite.close();
});
test('station pairing is single use, scoped, limited and revocable',async()=>{
 const {sqlite,call,data}=await fixture();await data('/api/admin/setup','POST',{code:'test-setup'});
 const {kitchen}=await data('/api/admin/kitchens','POST',{name:'مطبخ الأجهزة'});
 const invite=await data('/api/admin/invites','POST',{kitchenId:kitchen.id});await data('/api/auth/activate','POST',{code:invite.code,email:'manager@test.example',password:'a long test password'},'manager');
 const device=await data('/api/devices','POST',{name:'شاشة التحضير'},'manager');
 const paired=await call('/api/station/pair','POST',{code:device.code},null);assert.equal(paired.status,200);
 const cookie=paired.headers.get('set-cookie').split(';')[0];assert.match(paired.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await call('/api/station/pair','POST',{code:device.code},null)).status,400);
 assert.equal((await call('/api/station/session','GET',null,'manager')).status,401);
 assert.equal((await data('/api/station/session','GET',null,null,cookie)).role,'device');
 for(const [path,method] of [['settings','PUT'],['services','GET'],['devices','POST'],['admin/kitchens','POST']])assert.equal((await call('/api/station/'+path,method,method==='GET'?null:{},null,cookie)).status,403);
 const record={id:'record-one',timestamp:new Date().toISOString(),food:'rice',stage:'buffet',reason:'overproduction',meal:'lunch',weight:2,source:'manual'};
 await data('/api/station/records','POST',record,null,cookie);
 assert.equal((await data('/api/records','GET',null,'manager')).records.length,1);
 const device2=await data('/api/devices','POST',{name:'شاشة ثانية'},'manager');
 const paired2=await call('/api/station/pair','POST',{code:device2.code},null),cookie2=paired2.headers.get('set-cookie').split(';')[0];
 assert.equal((await data('/api/station/records','GET',null,null,cookie2)).records.length,0);
 assert.equal((await call('/api/station/records','POST',record,null,cookie2)).status,409);
 assert.equal((await call('/api/devices/'+device.id,'DELETE',null,'outsider')).status,401);
 await data('/api/devices/'+device.id,'DELETE',null,'manager');assert.equal((await call('/api/station/session','GET',null,null,cookie)).status,401);
 const expired=await data('/api/devices','POST',{name:'منتهي'},'manager');sqlite.prepare('UPDATE kitchen_devices SET pair_expires=0 WHERE id=?').run(expired.id);
 assert.equal((await call('/api/station/pair','POST',{code:expired.code},null)).status,400);
 sqlite.close();
});
test('admin can explicitly retain pre-kitchen records and settings',async()=>{
 const {sqlite,data}=await fixture();await data('/api/admin/setup','POST',{code:'test-setup'});
 sqlite.prepare('INSERT INTO waste_records (owner,id,timestamp,food,stage,reason,meal,grams,unit_cost,cost,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('admin','old','2026-01-04T10:00:00Z','rice','buffet','overproduction','lunch',1000,260,260,'manual');
 await data('/api/admin/kitchens','POST',{name:'مطبخي السابق',importPrevious:true});
 assert.equal((await data('/api/records')).records[0].id,'old');assert.equal((await data('/api/kitchen')).kitchen.name,'مطبخي السابق');sqlite.close();
});

test('manager email login works without ChatGPT, logout revokes cookie and reset invalidates sessions',async()=>{
 const {sqlite,call,data,cookies}=await fixture();await data('/api/admin/setup','POST',{code:'test-setup'});
 const {kitchen}=await data('/api/admin/kitchens','POST',{name:'دخول مستقل'});
 const invite=await data('/api/admin/invites','POST',{kitchenId:kitchen.id});
 const credentials={email:'local@test.example',password:'an independent password'};
 const activate=await call('/api/auth/activate','POST',{...credentials,code:invite.code},null);assert.equal(activate.status,200);
 const cookie=activate.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^__Host-mawazin_manager=/);
 const session=await data('/api/session','GET',null,null,cookie);assert.equal(session.role,'manager');assert.equal(session.user.email,credentials.email);
 assert.equal((await call('/api/admin/kitchens','GET',null,null,cookie)).status,401);
 assert.equal((await call('/api/settings','GET',null,null)).status,401);
 const stored=sqlite.prepare('SELECT * FROM manager_accounts').get();assert.notEqual(stored.password_hash,credentials.password);assert.match(stored.password_hash,/^\$2[ab]\$12\$/);
 assert.equal((await call('/api/auth/login','POST',{...credentials,password:'wrong long password'},null)).status,401);
 const login=await call('/api/auth/login','POST',credentials,null);assert.equal(login.status,200);
 const loginCookie=login.headers.get('set-cookie').split(';')[0];
 await data('/api/auth/logout','POST',{},null,loginCookie);assert.equal((await call('/api/session','GET',null,null,loginCookie)).status,401);
 const reset=await data('/api/admin/invites','POST',{kitchenId:kitchen.id});
 assert.equal((await call('/api/auth/activate','POST',{...credentials,password:'a changed long password',code:reset.code},null)).status,200);
 assert.equal((await call('/api/session','GET',null,null,cookie)).status,401);
 assert.equal((await call('/api/auth/login','POST',credentials,null)).status,401);
 assert.equal((await call('/api/auth/login','POST',{...credentials,password:'a changed long password'},null)).status,200);
 const forged=new Request('https://example.test/api/auth/login',{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify(credentials)});
 // Existing API origin tests cover writes; manager auth must also reject a missing Origin.
 const worker=createWorker();assert.equal((await worker.fetch(forged,{DB:{}})).status,403);
 sqlite.close();
});

test('password limits and login throttling are enforced',async()=>{
 const {sqlite,call}=await fixture();
 assert.equal((await call('/api/auth/login','POST',{email:'x@test.example',password:'short'},null)).status,400);
 assert.equal((await call('/api/auth/login','POST',{email:'x@test.example',password:'ع'.repeat(50)},null)).status,400);
 for(let i=0;i<8;i++)assert.equal((await call('/api/auth/login','POST',{email:'x@test.example',password:'unknown long password'},null)).status,401);
 assert.equal((await call('/api/auth/login','POST',{email:'x@test.example',password:'unknown long password'},null)).status,429);
 sqlite.close();
});
