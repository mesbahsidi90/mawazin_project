let database;
function open() {
  if (!database) database=new Promise((resolve,reject)=>{
    const req=indexedDB.open('mawazin-outbox',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('pending',{keyPath:['owner','id']});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{database=null;reject(req.error);};
  });
  return database;
}
export async function queueList(owner) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('pending').objectStore('pending').getAll();
    req.onsuccess=()=>resolve(req.result.filter(r=>r.owner===owner).map(({owner,...record})=>record));
    req.onerror=()=>reject(req.error);
  });
}
export async function queueWrite(owner,record) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('pending','readwrite');
    tx.objectStore('pending').put({...record,owner});
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function queueRemove(owner,id) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('pending','readwrite');tx.objectStore('pending').delete([owner,id]);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
