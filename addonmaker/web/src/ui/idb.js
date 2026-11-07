// Tiny IndexedDB key/value store for binary assets (custom sounds), which are
// too big for localStorage. Keys look like "<projectId>/<assetUid>".
const DB = 'mobsmith', STORE = 'blobs';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const putBlob = (key, bytes) => tx('readwrite', (s) => s.put(bytes, key));
export const getBlob = (key) => tx('readonly', (s) => s.get(key)).then((v) => (v ? new Uint8Array(v) : null));
export const delBlob = (key) => tx('readwrite', (s) => s.delete(key));
export function delPrefix(prefix) {
  return tx('readwrite', (s) => {
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const req = s.openCursor(range);
    req.onsuccess = () => { const c = req.result; if (c) { c.delete(); c.continue(); } };
    return req;
  });
}
export const soundKey = (projectId, uid) => `${projectId}/sound/${uid}`;
