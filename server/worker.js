import {defaultSettings,validateSettings,validateRecord,validateService} from '../dist/domain.js';

const json = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const dbFor = env => {if(!env.DB) throw new Error('Database binding missing'); return env.DB;};
async function getSettings(db,owner) {
  const row=await db.prepare('SELECT payload, revision FROM user_settings WHERE owner = ?').bind(owner).first();
  return {settings:row?validateSettings(JSON.parse(row.payload)):structuredClone(defaultSettings), revision:row?.revision??0};
}
async function bodyOf(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON required');
  const body=await request.text();
  if(body.length>100000) throw new Error('الطلب كبير جدًا');
  return JSON.parse(body);
}
export function createWorker(assets={}) {
  return {async fetch(request,env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/')) {
      if(request.method!=='GET' && request.method!=='HEAD') return new Response('Method not allowed',{status:405});
      if(url.pathname==='/station/') return Response.redirect(url.origin+'/station'+url.search,308);
      const key=(url.pathname==='/'||url.pathname==='/station')?'/index.html':url.pathname;
      const asset=assets[key];
      if(!asset) return new Response('Not found',{status:404});
      return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
    }
    // These headers are trustworthy only behind Sites dispatch, never on a public standalone Worker.
    const owner=request.headers.get('oai-authenticated-user-id');
    if(!owner) return json({error:'يلزم تسجيل الدخول'},401);
    if(!['GET','HEAD'].includes(request.method) && request.headers.get('origin')!==url.origin) return json({error:'Origin غير مسموح'},403);
    if(url.pathname==='/api/session' && request.method==='GET') return json({user:{id:owner,email:request.headers.get('oai-authenticated-user-email')??''},storage:'d1',scope:'personal'});
    try {
      const db=dbFor(env);
      if(url.pathname==='/api/food-images' && request.method==='POST') {
        if(request.headers.get('content-type')!=='image/webp') return json({error:'صورة غير صالحة؛ يلزم WebP'},400);
        const bytes=await request.arrayBuffer();
        const head=new Uint8Array(bytes);
        if(bytes.byteLength>350000||bytes.byteLength<12||String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WEBP') return json({error:'صورة غير صالحة أو كبيرة جدًا'},400);
        const id=crypto.randomUUID();
        await env.PHOTOS.put(encodeURIComponent(owner)+'/'+id,bytes,{httpMetadata:{contentType:'image/webp'}});
        return json({photo:'/api/food-images/'+id});
      }
      if(/^\/api\/food-images\/[a-f0-9-]{36}$/.test(url.pathname) && request.method==='GET') {
        const object=await env.PHOTOS.get(encodeURIComponent(owner)+'/'+url.pathname.split('/').at(-1));
        if(!object)return json({error:'الصورة غير موجودة'},404);
        return new Response(object.body,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(url.pathname==='/api/health' && request.method==='GET') {
        await db.prepare('SELECT 1').first();
        return json({ok:true,time:new Date().toISOString()});
      }
      if(url.pathname==='/api/settings' && request.method==='GET') return json(await getSettings(db,owner));
      if(url.pathname==='/api/services' && request.method==='GET') {
        const rows=await db.prepare('SELECT * FROM meal_services WHERE owner = ? ORDER BY date DESC, meal').bind(owner).all();
        return json({services:rows.results.map(r=>({date:r.date,meal:r.meal,meals:r.meals,productionKg:r.production_grams/1000,revision:r.revision}))});
      }
      if(url.pathname==='/api/services' && request.method==='PUT') {
        const r=validateService(await bodyOf(request));
        const statement=r.revision===0
          ? db.prepare('INSERT INTO meal_services (owner,date,meal,meals,production_grams,revision) VALUES (?,?,?,?,?,1) ON CONFLICT(owner,date,meal) DO NOTHING').bind(owner,r.date,r.meal,r.meals,Math.round(r.productionKg*1000))
          : db.prepare('UPDATE meal_services SET meals=?,production_grams=?,revision=revision+1 WHERE owner=? AND date=? AND meal=? AND revision=?').bind(r.meals,Math.round(r.productionKg*1000),owner,r.date,r.meal,r.revision);
        const result=await statement.run();
        if(!result.meta?.changes) return json({error:'عُدلت الوجبة من جهاز آخر. أعد تحميل الوجبات قبل الحفظ.'},409);
        return json({service:{...r,revision:r.revision+1}});
      }
      if(url.pathname==='/api/settings' && request.method==='PUT') {
        const input=await bodyOf(request), settings=validateSettings(input.settings);
        const previous=await getSettings(db,owner);
        if(Object.keys(previous.settings.unitPrices).some(key=>!Object.hasOwn(settings.unitPrices,key))) return json({error:'لا تحذف الأصناف السابقة؛ أوقف ظهورها للحفاظ على السجلات.'},400);
        if(!Number.isInteger(input.revision)||input.revision<0) return json({error:'نسخة إعدادات غير صالحة'},400);
        const statement=input.revision===0
          ? db.prepare('INSERT INTO user_settings (owner,payload,revision) VALUES (?,?,1) ON CONFLICT(owner) DO NOTHING').bind(owner,JSON.stringify(settings))
          : db.prepare('UPDATE user_settings SET payload = ?, revision = revision + 1 WHERE owner = ? AND revision = ?').bind(JSON.stringify(settings),owner,input.revision);
        const result=await statement.run();
        if(!result.meta?.changes) return json({error:'عُدلت الإعدادات من جهاز آخر. أعد تحميلها قبل الحفظ.'},409);
        return json({settings,revision:input.revision+1});
      }
      if(url.pathname==='/api/records' && request.method==='GET') {
        const cursor=Number(url.searchParams.get('cursor')??0);
        if(!Number.isSafeInteger(cursor)||cursor<0) return json({error:'مؤشر غير صالح'},400);
        const result=await db.prepare('SELECT rowid AS cursor, * FROM waste_records WHERE owner = ? AND rowid > ? ORDER BY rowid LIMIT 500').bind(owner,cursor).all();
        const rows=result.results??[];
        return json({records:rows.map(r=>({id:r.id,timestamp:r.timestamp,food:r.food,stage:r.stage,reason:r.reason,meal:r.meal,weight:r.grams/1000,unitCost:r.unit_cost,cost:r.cost,source:r.source,note:r.note})),nextCursor:rows.length===500?rows.at(-1).cursor:null});
      }
      if(url.pathname==='/api/records' && request.method==='POST') {
        const input=await bodyOf(request);
        const {settings}=await getSettings(db,owner);
        const r=validateRecord(input,settings);
        // Unique owner/id makes retry safe, including a lost successful response.
        await db.prepare('INSERT INTO waste_records (owner,id,timestamp,food,stage,reason,meal,grams,unit_cost,cost,source,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO NOTHING')
          .bind(owner,r.id,r.timestamp,r.food,r.stage,r.reason,r.meal,Math.round(r.weight*1000),r.unitCost,r.cost,r.source,r.note).run();
        const saved=await db.prepare('SELECT * FROM waste_records WHERE owner = ? AND id = ?').bind(owner,r.id).first();
        return json({record:{id:saved.id,timestamp:saved.timestamp,food:saved.food,stage:saved.stage,reason:saved.reason,meal:saved.meal,weight:saved.grams/1000,unitCost:saved.unit_cost,cost:saved.cost,source:saved.source,note:saved.note}});
      }
      return json({error:'المسار غير موجود'},404);
    } catch(error) {
      if(error instanceof SyntaxError || /غير صالح|غير صالحة|الوزن|التاريخ|الملاحظة|أسعار|JSON required|كبير جدًا/.test(error.message)) return json({error:error.message},400);
      console.error('Mawazin API failed',url.pathname,error.message);
      return json({error:'تعذر الوصول إلى التخزين المركزي. أعد المحاولة؛ تسجيلاتك المعلقة باقية.'},503);
    }
  }};
}
