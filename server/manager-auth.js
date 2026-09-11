import bcrypt from 'bcryptjs';

const authJson=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const authHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const authSecret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const sessionCookie=token=>'__Host-mawazin_manager='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+(token?2592000:0);
const cookieToken=request=>(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-mawazin_manager='))?.slice('__Host-mawazin_manager='.length);
async function authInput(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('JSON required');const text=await request.text();if(text.length>4000)throw Error('الطلب كبير جدًا');return JSON.parse(text);}
function credentials(body){
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('بريد غير صالح');
 const password=body.password;
 if(typeof password!=='string'||password.length<15||new TextEncoder().encode(password).length>72)throw Error('كلمة مرور غير صالحة: استخدم 15 حرفًا على الأقل وبحد أقصى 72 بايت');
 return {email,password};
}
async function limit(db,key,max){
 const now=Date.now();
 const row=await db.prepare('INSERT INTO auth_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(key,now+900000,now,now).first();
 return row.count<=max;
}
async function newSession(db,actor,version){
 const token=authSecret();
 await db.prepare('INSERT INTO manager_sessions (hash,actor,version,expires_at) SELECT ?,actor,version,? FROM manager_accounts WHERE actor=? AND version=?').bind(await authHash(token),Date.now()+2592000000,actor,version).run();
 return authJson({ok:true},200,{'Set-Cookie':sessionCookie(token)});
}
export async function managerIdentity(request,db){
 const token=cookieToken(request);if(!token)return null;
 return db.prepare('SELECT a.actor,a.email FROM manager_sessions s JOIN manager_accounts a ON a.actor=s.actor AND a.version=s.version WHERE s.hash=? AND s.expires_at>?').bind(await authHash(token),Date.now()).first();
}
export async function managerAuth(request,env,url){
 if(!['/api/auth/login','/api/auth/activate','/api/auth/logout'].includes(url.pathname))return null;
 if(request.method!=='POST')return authJson({error:'الطريقة غير مسموحة'},405);
 const db=env.DB;
 if(url.pathname==='/api/auth/logout'){
   const token=cookieToken(request);if(token)await db.prepare('DELETE FROM manager_sessions WHERE hash=?').bind(await authHash(token)).run();
   return authJson({ok:true},200,{'Set-Cookie':sessionCookie('')});
 }
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 if(!await limit(db,'ip:'+await authHash(ip),40))return authJson({error:'محاولات كثيرة. أعد المحاولة بعد 15 دقيقة.'},429);
 const body=await authInput(request),{email,password}=credentials(body),emailKey='email:'+await authHash(email);
 if(!await limit(db,emailKey,8))return authJson({error:'محاولات كثيرة. أعد المحاولة بعد 15 دقيقة.'},429);
 const account=await db.prepare('SELECT * FROM manager_accounts WHERE email=?').bind(email).first();
 if(url.pathname==='/api/auth/login'){
   // A fixed valid bcrypt hash keeps missing-account work comparable to a failed password.
   const valid=await bcrypt.compare(password,account?.password_hash||'$2b$12$C6UzMDM.H6dfI/f/IKcEe.5Hh6zT5Zfu2AqAO9WFlr.ujcmTIHPfK');
   if(!account||!valid)return authJson({error:'البريد أو كلمة المرور غير صحيحة'},401);
   await db.prepare('DELETE FROM auth_limits WHERE key=?').bind(emailKey).run();
   return newSession(db,account.actor,account.version);
 }
 if(typeof body.code!=='string'||body.code.length>200)return authJson({error:'رمز التفعيل غير صالح'},400);
 const hash=await authHash(body.code.trim()),now=Date.now();
 const invitation=await db.prepare('SELECT * FROM manager_invites WHERE hash=? AND claimed_by IS NULL AND expires_at>?').bind(hash,now).first();
 if(!invitation)return authJson({error:'رابط التفعيل منتهي أو مستعمل. اطلب رابطًا جديدًا من الأدمن.'},400);
 if(account){
   const membership=await db.prepare('SELECT kitchen_id FROM kitchen_memberships WHERE actor=?').bind(account.actor).first();
   if(membership?.kitchen_id!==invitation.kitchen_id)return authJson({error:'لا يمكن تفعيل هذا البريد لهذه الدعوة'},409);
 }
 const actor=account?.actor||'manager:'+crypto.randomUUID(),version=crypto.randomUUID(),claim=authSecret();
 const salt=await bcrypt.genSalt(12),passwordHash=await bcrypt.hash(password,salt);
 await db.batch([
   db.prepare('UPDATE manager_invites SET claimed_by=? WHERE hash=? AND claimed_by IS NULL AND expires_at>?').bind(claim,hash,Date.now()),
   db.prepare('INSERT INTO manager_accounts (actor,email,password_hash,salt,version) SELECT ?,?,?,?,? FROM manager_invites WHERE hash=? AND claimed_by=? ON CONFLICT(actor) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,version=excluded.version').bind(actor,email,passwordHash,salt,version,hash,claim),
   db.prepare('INSERT INTO kitchen_memberships (actor,kitchen_id) SELECT ?,kitchen_id FROM manager_invites WHERE hash=? AND claimed_by=? ON CONFLICT(actor) DO NOTHING').bind(actor,hash,claim),
 ]);
 const claimed=await db.prepare('SELECT claimed_by FROM manager_invites WHERE hash=?').bind(hash).first();
 if(claimed?.claimed_by!==claim)return authJson({error:'رابط التفعيل مستعمل'},409);
 await db.prepare('DELETE FROM auth_limits WHERE key=?').bind(emailKey).run();
 return newSession(db,actor,version);
}
