// Bridge to the Android shell (window.MobsmithAndroid). Every call has a
// browser fallback so the same UI runs in a desktop browser for testing.
import { bytesToBase64 } from '../core/util.js';

const A = typeof window !== 'undefined' ? window.MobsmithAndroid : null;
export const isAndroid = !!A;

let seq = 0;
const pending = new Map();
if (typeof window !== 'undefined') {
  window.__mobsmithNative = (id, ok, msg) => {
    const p = pending.get(Number(id));
    if (p) { pending.delete(Number(id)); p({ ok: !!ok, msg: msg || '' }); }
  };
}

function download(name, bytes, mime) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Lets the user choose where to save (Android: system file picker). */
export function saveFile(name, bytes, mime = 'application/octet-stream') {
  if (!A) { download(name, bytes, mime); return Promise.resolve({ ok: true, msg: 'Downloaded' }); }
  const id = ++seq;
  return new Promise((res) => {
    pending.set(id, res);
    A.saveFile(String(id), name, bytesToBase64(bytes), mime);
  });
}

/** Hands an .mcaddon/.mcpack to Minecraft, which imports it. */
export function openInGame(name, bytes) {
  if (!A) { download(name, bytes); return { ok: true, msg: 'Downloaded. Open the file to import it into Minecraft.' }; }
  const r = A.openInGame(name, bytesToBase64(bytes));
  return { ok: r === 'ok', msg: r === 'ok' ? 'Opening Minecraft…' : r };
}

export function shareFile(name, bytes, mime = 'application/octet-stream') {
  if (!A) {
    if (navigator.share && navigator.canShare) {
      const f = new File([bytes], name, { type: mime });
      if (navigator.canShare({ files: [f] })) return navigator.share({ files: [f] }).then(() => ({ ok: true }), () => ({ ok: false }));
    }
    download(name, bytes, mime);
    return Promise.resolve({ ok: true });
  }
  A.shareFile(name, bytesToBase64(bytes), mime);
  return Promise.resolve({ ok: true });
}

export function openUrl(url) {
  if (A) A.openUrl(url); else window.open(url, '_blank', 'noopener');
}

export function copyText(text) {
  if (A) { A.copyText(text); return; }
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function appVersion() { return A ? A.version() : 'web'; }

/** Opens the system file picker (works in the Android WebView via onShowFileChooser). */
export function pickFile(accept) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.style.display = 'none';
    inp.onchange = () => { const f = inp.files?.[0]; inp.remove(); res(f || null); };
    document.body.appendChild(inp);
    inp.click();
  });
}
export const readAsText = (f) => f.text();
export const readAsBytes = async (f) => new Uint8Array(await f.arrayBuffer());
export function readAsDataURL(f) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
}
