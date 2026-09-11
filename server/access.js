import {defaultSettings} from '../dist/domain.js';
import {managerAuth,managerIdentity} from './manager-auth.js';
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const secret = () => crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const reply = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
async function input(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON required');const text=await request.text();if(text.length>100000)throw new Error('الطلب كبير جدًا');return JSON.parse(text);}
function label(value){if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw new Error('اسم غير صالح');return value.trim();}
export async function access(request,env,url) {
  const db=env.DB,platformActor=request.headers.get('oai-authenticated-user-id'),now=Date.now();
  const authResponse=await managerAuth(request,env,url);if(authResponse)return authResponse;
  const station=url.pathname.startsWith('/api/station/');
  if(station) {
    url.pathname=url.pathname.replace('/api/station/','/api/');
    if(url.pathname==='/api/pair'&&request.method==='POST') {
      const {code}=await input(request);if(typeof code!=='string'||code.length>200)return reply({error:'رمز غير صالح'},400);
      const token=secret();
      const row=await db.prepare("UPDATE kitchen_devices SET token_hash=?,status='active',last_seen=? WHERE pair_hash=? AND status='pending' AND pair_expires>? RETURNING id").bind(await digest(token),new Date().toISOString(),await digest(code.trim()),now).first();
      if(!row)return reply({error:'رمز الربط غير صالح أو منتهي أو مستعمل'},400);
      return reply({ok:true},200,{'Set-Cookie':'mawazin_device='+token+'; Path=/api/station; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000'});
    }
    const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mawazin_device='))?.slice(15);
    if(!token)return reply({error:'اربط هذا الجهاز من صفحة المطبخ'},401);
    const device=await db.prepare("SELECT d.id,k.owner,k.id AS kitchen_id FROM kitchen_devices d JOIN kitchens k ON k.id=d.kitchen_id WHERE d.token_hash=? AND d.status='active'").bind(await digest(token)).first();
    if(!device)return reply({error:'تم إلغاء ربط الجهاز؛ اطلب رمزًا جديدًا'},401);
    const allowed=(request.method==='GET'&&['/api/session','/api/kitchen','/api/settings','/api/health','/api/records'].includes(url.pathname))||(request.method==='GET'&&/^\/api\/food-images\/[a-f0-9-]{36}$/.test(url.pathname))||(request.method==='POST'&&url.pathname==='/api/records');
    if(!allowed)return reply({error:'الجهاز مخصص لتسجيل الهدر فقط'},403);
    await db.prepare('UPDATE kitchen_devices SET last_seen=? WHERE id=?').bind(new Date().toISOString(),device.id).run();
    return {owner:device.owner,kitchenId:device.kitchen_id,deviceId:device.id,role:'device',queueId:device.owner+':device:'+device.id};
  }
  const identity=await managerIdentity(request,db);
  const admin=platformActor?await db.prepare('SELECT actor FROM platform_admins WHERE actor=?').bind(platformActor).first():null;
  const actor=url.pathname.startsWith('/api/admin/')?platformActor:identity?.actor||platformActor;
  if(!actor)return reply({error:'يلزم تسجيل الدخول'},401);
  if(url.pathname==='/api/admin/setup'&&request.method==='POST') {
    const {code}=await input(request);
    if(!env.ADMIN_SETUP_HASH||typeof code!=='string'||await digest(code)!==env.ADMIN_SETUP_HASH)return reply({error:'رمز إعداد الأدمن غير صالح'},403);
    await db.prepare("INSERT INTO platform_admins (slot,actor) VALUES ('primary',?) ON CONFLICT(slot) DO NOTHING").bind(actor).run();
    const row=await db.prepare("SELECT actor FROM platform_admins WHERE slot='primary'").first();
    return row.actor===actor?reply({ok:true}):reply({error:'تم تفعيل حساب الأدمن مسبقًا'},403);
  }
  if(url.pathname.startsWith('/api/admin/')) {
    if(!admin)return reply({error:'هذه العملية للأدمن فقط'},403);
    if(url.pathname==='/api/admin/session'&&request.method==='GET')return reply({role:'admin'});
    if(url.pathname==='/api/admin/kitchens'&&request.method==='GET') {
      const rows=await db.prepare('SELECT k.id,k.created_at,s.payload,(SELECT COUNT(*) FROM kitchen_memberships m WHERE m.kitchen_id=k.id) AS managers,(SELECT COUNT(*) FROM kitchen_devices d WHERE d.kitchen_id=k.id AND d.status!=\'revoked\') AS devices FROM kitchens k LEFT JOIN user_settings s ON s.owner=k.owner ORDER BY k.created_at DESC').all();
      return reply({kitchens:rows.results.map(r=>({id:r.id,name:r.payload?JSON.parse(r.payload).siteName:'مطبخ',createdAt:r.created_at,managers:r.managers,devices:r.devices}))});
    }
    if(url.pathname==='/api/admin/kitchens'&&request.method==='POST') {
      const data=await input(request),name=label(data.name),id=crypto.randomUUID(),owner=data.importPrevious===true?actor:'kitchen:'+id;
      if(await db.prepare('SELECT id FROM kitchens WHERE owner=?').bind(owner).first())return reply({error:'بيانات الحساب مرتبطة بمطبخ موجود'},409);
      const old=await db.prepare('SELECT payload FROM user_settings WHERE owner=?').bind(owner).first();
      const settings=old?JSON.parse(old.payload):structuredClone(defaultSettings);settings.siteName=name;
      await db.batch([db.prepare('INSERT INTO kitchens (id,owner,created_at) VALUES (?,?,?)').bind(id,owner,new Date().toISOString()),db.prepare('INSERT INTO user_settings (owner,payload,revision) VALUES (?,?,1) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,revision=revision+1').bind(owner,JSON.stringify(settings))]);
      return reply({kitchen:{id,name}},201);
    }
    if(url.pathname==='/api/admin/invites'&&request.method==='POST') {
      const {kitchenId}=await input(request);
      if(typeof kitchenId!=='string'||!await db.prepare('SELECT id FROM kitchens WHERE id=?').bind(kitchenId).first())return reply({error:'مطبخ غير موجود'},404);
      const code=secret(),expiresAt=now+48*3600000;
      await db.batch([db.prepare('DELETE FROM manager_invites WHERE kitchen_id=? AND claimed_by IS NULL').bind(kitchenId),db.prepare('INSERT INTO manager_invites (hash,kitchen_id,expires_at) VALUES (?,?,?)').bind(await digest(code),kitchenId,expiresAt)]);
      return reply({code,expiresAt,url:url.origin+'/kitchen#invite='+code},201);
    }
    return reply({error:'المسار غير موجود'},404);
  }
  if(url.pathname==='/api/claim-manager')return reply({error:'فعّل حساب المدير بالبريد وكلمة المرور'},410);
  if(!identity&&!admin)return reply({error:'ادخل بالبريد وكلمة المرور أو فعّل دعوة الأدمن'},401);
  const kitchen=await db.prepare('SELECT k.id,k.owner FROM kitchen_memberships m JOIN kitchens k ON k.id=m.kitchen_id WHERE m.actor=?').bind(actor).first()||await db.prepare('SELECT id,owner FROM kitchens WHERE owner=?').bind(actor).first();
  const role=(!identity&&admin)?'admin':kitchen?'manager':'waiting';
  if(url.pathname==='/api/session')return reply({user:{id:kitchen?.owner||actor,email:identity?.email||request.headers.get('oai-authenticated-user-email')||''},role,kitchenId:kitchen?.id||null,storage:'d1'});
  if(!kitchen)return reply({error:'اطلب رمز تفعيل مطبخك من الأدمن'},403);
  if(url.pathname==='/api/kitchen'&&request.method!=='GET')return reply({error:'إنشاء المطابخ من لوحة الأدمن فقط'},403);
  if(url.pathname==='/api/devices'&&request.method==='GET') {
    const rows=await db.prepare('SELECT id,name,status,created_at,last_seen,last_sync,pair_expires FROM kitchen_devices WHERE kitchen_id=? ORDER BY created_at DESC').bind(kitchen.id).all();return reply({devices:rows.results});
  }
  if(url.pathname==='/api/devices'&&request.method==='POST') {
    const {name}=await input(request),code=secret(),id=crypto.randomUUID(),expiresAt=now+600000;
    await db.prepare('INSERT INTO kitchen_devices (id,kitchen_id,name,pair_hash,pair_expires,status,created_at) VALUES (?,?,?,?,?,\'pending\',?)').bind(id,kitchen.id,label(name),await digest(code),expiresAt,new Date().toISOString()).run();
    return reply({id,code,expiresAt,url:url.origin+'/station#pair='+code},201);
  }
  if(url.pathname.startsWith('/api/devices/')&&request.method==='DELETE') {
    const result=await db.prepare("UPDATE kitchen_devices SET status='revoked',token_hash=NULL WHERE id=? AND kitchen_id=?").bind(url.pathname.split('/').at(-1),kitchen.id).run();
    return result.meta?.changes?reply({ok:true}):reply({error:'الجهاز غير موجود'},404);
  }
  return {owner:kitchen.owner,kitchenId:kitchen.id,role,queueId:kitchen.owner};
}
