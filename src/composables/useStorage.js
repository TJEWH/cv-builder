// tiny storage & debounce helpers
export const STORAGE_KEY = 'cvData.v1';

export const debounce = (fn, ms=300) => {
    let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
};

export const loadLocal = () => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
};

export const saveLocal = (data) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
};

export const exportJSON = (data, filename='cv-session.json') => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
};

export const importJSON = (file) => new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(r.result)); } catch(e){ reject(e); } };
    r.onerror = reject;
    r.readAsText(file);
});
