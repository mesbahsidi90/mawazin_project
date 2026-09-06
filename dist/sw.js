const CACHE='mawazin-shell-v2';
const SHELL=['/','/index.html','/styles.css','/app.js','/domain.js','/outbox.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{
  // Only generic shell/assets. No account data, cookies, API responses or login redirects.
  for(const path of SHELL) {
    const response=await fetch(path,{redirect:'error',cache:'reload'});
    if(!response.ok) throw new Error('Offline shell unavailable');
    await cache.put(path,response);
  }
})));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mawazin-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname)||url.search) return;
  event.respondWith(fetch(event.request,{redirect:'error'}).catch(()=>caches.match(url.pathname).then(r=>r??Response.error())));
});
