// src/composables/useStorage.js
export const STORAGE_KEY = 'cv-session';
export const BACKUP_KEY  = 'cv-backup-json';
export const MODE_KEY    = 'cv-backup-mode'; // 'browser' | 'file'
const FILE_HANDLE_KEY    = 'cv-backup-handle';

export function debounce(fn, wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

// Local session
export function saveLocal(obj){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }catch(e){ console.warn('saveLocal failed', e); } }
export function loadLocal(){ try{ const raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):null; }catch(e){ console.warn('loadLocal failed', e); return null; } }

// Mode
export function getBackupMode(){ return localStorage.getItem(MODE_KEY) || 'browser'; }
export function setBackupMode(mode){ localStorage.setItem(MODE_KEY, (mode==='file'?'file':'browser')); }

// Feature detection
export function fsApiAvailable(){ return typeof window!=='undefined' && typeof window.showSaveFilePicker==='function' && typeof window.showOpenFilePicker==='function'; }
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
async function serverAvailable(){ if(!IS_DEV) return false; try{ const r=await fetch('/__backup/ping',{cache:'no-store'}); return r.ok; }catch{ return false; } }

// IndexedDB (nur für FS-API in Chromium)
const DB_NAME='cv-store', STORE='handles';
function openDB(){ return new Promise((res,rej)=>{ const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>{ req.result.createObjectStore(STORE); }; req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
async function idbSet(key,val){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(val,key); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbGet(key){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const rq=tx.objectStore(STORE).get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }

// OPFS & LS
async function opfsAvailable(){ return !!(navigator.storage && navigator.storage.getDirectory); }
async function writeBackupOPFS(data){ const dir=await navigator.storage.getDirectory(); const file=await dir.getFileHandle('cv-backup.json',{create:true}); const w=await file.createWritable(); await w.write(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); await w.close(); try{ await navigator.storage.persist?.(); }catch{} return { ok:true, where:'opfs' }; }
async function readBackupOPFS(){ const dir=await navigator.storage.getDirectory(); const fh=await dir.getFileHandle('cv-backup.json'); const f=await fh.getFile(); return JSON.parse(await f.text()); }
function writeBackupLS(data){ localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); return { ok:true, where:'localStorage' }; }
function readBackupLS(){ const raw=localStorage.getItem(BACKUP_KEY); return raw?JSON.parse(raw):null; }

// FS-API (Chromium Projektdatei)
async function ensureRWPermission(handle){ if(!handle?.queryPermission||!handle?.requestPermission) return false; const q=await handle.queryPermission({mode:'readwrite'}); if(q==='granted') return true; const r=await handle.requestPermission({mode:'readwrite'}); return r==='granted'; }
async function writeBackupFILE(data){ let handle=await idbGet(FILE_HANDLE_KEY); if(!handle || !(await ensureRWPermission(handle))){ const opts={ suggestedName:'cv-backup.json', types:[{description:'JSON', accept:{'application/json':['.json']}}] }; handle=await window.showSaveFilePicker(opts); await idbSet(FILE_HANDLE_KEY, handle); } if(!(await ensureRWPermission(handle))) throw new Error('Keine Schreibberechtigung.'); const w=await handle.createWritable(); await w.write(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); await w.close(); return { ok:true, where:'file' }; }
async function readBackupFILE(){ let handle=await idbGet(FILE_HANDLE_KEY); if(!handle || !(await ensureRWPermission(handle))){ const [picked]=await window.showOpenFilePicker({multiple:false, types:[{description:'JSON', accept:{'application/json':['.json']}}]}); handle=picked; await idbSet(FILE_HANDLE_KEY, handle); } if(!(await ensureRWPermission(handle))) throw new Error('Keine Leseberechtigung.'); const file=await handle.getFile(); return JSON.parse(await file.text()); }

// Dev-Server Endpoints (Firefox/Safari Projektdatei)
async function writeBackupSERVER(data){
    const r = await fetch('/__backup/cv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if(!r.ok){
        const txt = await r.text().catch(()=> '');
        throw new Error(`server_write_failed: ${r.status} ${r.statusText} ${txt}`);
    }
    const j = await r.json().catch(()=>({ok:true}));
    return { ok:true, where:'server', ...(j||{}) };
}
async function readBackupSERVER(){
    const r = await fetch('/__backup/cv', { cache:'no-store' });
    if(!r.ok) return null;
    return await r.json();
}

// Public API
export async function writeBackup(data, mode = getBackupMode()){
    try{
        if (mode === 'file'){
            if (fsApiAvailable()) return await writeBackupFILE(data);          // Chromium
            if (await serverAvailable()) return await writeBackupSERVER(data);  // Firefox/Safari via Dev-Server
            if (await opfsAvailable())  return await writeBackupOPFS(data);     // Fallback
            return writeBackupLS(data);                                          // Last resort
        } else {
            if (await opfsAvailable()) return await writeBackupOPFS(data);
            return writeBackupLS(data);
        }
    }catch(e){
        console.warn('writeBackup failed', e);
        try{ return writeBackupLS(data); }catch(err){ return { ok:false, where:'none', error:err }; }
    }
}

export async function readBackup(mode = getBackupMode()){
    try{
        if (mode === 'file'){
            if (fsApiAvailable()) return await readBackupFILE();
            if (await serverAvailable()) return await readBackupSERVER();
            if (await opfsAvailable()){ try{ return await readBackupOPFS(); }catch{} }
            return readBackupLS();
        } else {
            if (await opfsAvailable()){ try{ return await readBackupOPFS(); }catch{} }
            return readBackupLS();
        }
    }catch(e){ console.warn('readBackup failed', e); return null; }
}

export async function loadBackupIntoLocal(mode = getBackupMode()){
    const data = await readBackup(mode);
    if(data){ saveLocal(data); return { ok:true, data }; }
    return { ok:false, data:null };
}
