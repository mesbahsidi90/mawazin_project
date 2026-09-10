export const prices = {rice:260, chicken:620, bread:140, salad:200, vegetables:180, potatoes:120, soup:150, dessert:450};
export const defaultCatalog = Object.fromEntries(Object.keys(prices).map((id,i)=>[id,{label:['أرز','دجاج','خبز','سلطة','خضر مطهوة','بطاطا','شوربة','حلويات'][i],image:i,active:true,meals:['breakfast','lunch','dinner']}]));
export const defaultSettings = {siteName:'مطبخ الجزائر الوسطى', dailyTarget:15, unitPrices:prices};
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Algiers', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const get = key => parts.find(p=>p.type===key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateSettings(input) {
  if (!input || typeof input.siteName!=='string' || !input.siteName.trim() || input.siteName.length>80 || !Number.isFinite(input.dailyTarget) || input.dailyTarget<0 || input.dailyTarget>10000) throw new Error('إعدادات المطبخ غير صالحة');
  const unitPrices = {};
  const catalog = {};
  const supplied = input.catalog ?? defaultCatalog;
  if (!supplied || typeof supplied!=='object' || Array.isArray(supplied) || Object.keys(supplied).length>100) throw new Error('قائمة الأصناف غير صالحة');
  for(const [key,item] of Object.entries(supplied)) {
    if (!/^[a-z][a-z0-9-]{0,60}$/.test(key) || ['constructor','prototype','__proto__'].includes(key) || !item || typeof item.label!=='string' || !item.label.trim() || item.label.length>60 || typeof item.active!=='boolean' || !Array.isArray(item.meals) || item.meals.some(m=>!['breakfast','lunch','dinner'].includes(m)) || !item.meals.length || !(Number.isInteger(item.image)&&item.image>=0&&item.image<8)) throw new Error('بيانات الصنف غير صالحة');
    if(item.photo!==undefined && (typeof item.photo!=='string'||!/^\/api\/food-images\/[a-f0-9-]{36}$/.test(item.photo))) throw new Error('صورة الصنف غير صالحة');
    catalog[key]={label:item.label.trim(),image:item.image,active:item.active,meals:[...new Set(item.meals)],...(item.photo?{photo:item.photo}:{})};
  }
  if(!Object.values(catalog).some(x=>x.active)) throw new Error('قائمة الأصناف غير صالحة: يلزم صنف نشط');
  for(const key of Object.keys(catalog)) {
    const value = input.unitPrices?.[key];
    if (!Number.isInteger(value) || value<0 || value>1000000) throw new Error('أسعار الأصناف يجب أن تكون أعدادًا صحيحة موجبة أو صفرًا');
    unitPrices[key]=value;
  }
  return {siteName:input.siteName.trim(),dailyTarget:input.dailyTarget,unitPrices,catalog};
}
export function validateRecord(input, settings=defaultSettings) {
  if (!input || typeof input.id!=='string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id)) throw new Error('معرف السجل غير صالح');
  for (const [key, allowed] of Object.entries({food:Object.keys(settings.unitPrices),stage:['prep','surplus','buffet','plates','storage'],reason:['overproduction','portion','spoilage','prep_error','quality','unavoidable'],meal:['breakfast','lunch','dinner'],source:['manual','simulator']})) {
    if (!allowed.includes(input[key])) throw new Error(`قيمة غير صالحة: ${key}`);
  }
  if (!Number.isFinite(input.weight) || input.weight<0.02 || input.weight>20) throw new Error('الوزن المسموح من 0.020 إلى 20 كغ');
  const time = new Date(input.timestamp).getTime();
  if (!Number.isFinite(time) || time>Date.now()+300000 || time<Date.UTC(2020,0,1)) throw new Error('التاريخ غير صالح');
  if (input.note!==undefined && (typeof input.note!=='string' || input.note.length>300)) throw new Error('الملاحظة طويلة');
  const weight=Math.round(input.weight*1000)/1000;
  const unitCost=settings.unitPrices[input.food];
  return {id:input.id,timestamp:new Date(time).toISOString(),food:input.food,stage:input.stage,reason:input.reason,meal:input.meal,source:input.source,weight,unitCost,cost:Math.round(weight*unitCost),note:input.note??''};
}
export function filterRecords(rows, filters={}) {
  return rows.filter(row => {
    const day=dayKey(row.timestamp);
    return (!filters.start || day>=filters.start) && (!filters.end || day<=filters.end) && (!filters.food || row.food===filters.food) && (!filters.stage || row.stage===filters.stage) && (!filters.source || row.source===filters.source);
  });
}
export function csvText(rows) {
  return '\ufeff'+rows.map(row=>row.map(value=>{
    let text=String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}

export function validateService(input) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10)!==input.date || input.date<'2020-01-01' || input.date>dayKey(new Date()) || !['breakfast','lunch','dinner'].includes(input.meal) || !Number.isInteger(input.meals) || input.meals<0 || input.meals>100000 || !Number.isFinite(input.productionKg) || input.productionKg<0 || input.productionKg>100000 || !Number.isInteger(input.revision) || input.revision<0) throw new Error('بيانات الوجبة غير صالحة');
  return {date:input.date,meal:input.meal,meals:input.meals,productionKg:Math.round(input.productionKg*1000)/1000,revision:input.revision};
}
export function serviceMetrics(records, services) {
  const keys=new Set(services.map(s=>s.date+'|'+s.meal));
  const covered=records.filter(r=>r.source==='manual'&&keys.has(dayKey(r.timestamp)+'|'+r.meal));
  const waste=covered.reduce((s,r)=>s+r.weight,0), meals=services.reduce((s,r)=>s+r.meals,0), production=services.reduce((s,r)=>s+r.productionKg,0);
  return {waste,meals,production,gramsPerMeal:meals>0?waste*1000/meals:null,wastePercent:production>0?waste*100/production:null,excluded:records.filter(r=>r.source==='manual'&&!keys.has(dayKey(r.timestamp)+'|'+r.meal)).length};
}
