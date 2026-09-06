export const prices = {rice:260, chicken:620, bread:140, salad:200, vegetables:180, potatoes:120, soup:150, dessert:450};
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
  for(const key of Object.keys(prices)) {
    const value = input.unitPrices?.[key];
    if (!Number.isInteger(value) || value<0 || value>1000000) throw new Error('أسعار الأصناف يجب أن تكون أعدادًا صحيحة موجبة أو صفرًا');
    unitPrices[key]=value;
  }
  return {siteName:input.siteName.trim(),dailyTarget:input.dailyTarget,unitPrices};
}
export function validateRecord(input, settings=defaultSettings) {
  if (!input || typeof input.id!=='string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id)) throw new Error('معرف السجل غير صالح');
  for (const [key, allowed] of Object.entries({food:Object.keys(prices),stage:['prep','surplus','buffet','plates','storage'],reason:['overproduction','portion','spoilage','prep_error','quality','unavoidable'],meal:['breakfast','lunch','dinner'],source:['manual','simulator']})) {
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
