// App state: the open project (mutable, saved to localStorage), navigation,
// undo/redo snapshots and toasts. Components re-render through useStore().
import { useEffect, useState } from 'preact/hooks';
import { migrateProject } from '../core/model.js';
import { packUVs } from '../core/geo.js';

const IDX = 'mobsmith.index';
const PKEY = (id) => `mobsmith.p.${id}`;
const listeners = new Set();

export const state = {
  project: null,
  route: { screen: 'home' }, // home | project | entity
  entityUid: null,
  tab: 'overview',
  toasts: [],
  modal: null,
  rev: 0,
};
const undoStack = [], redoStack = [];
let lastCommit = { t: 0, key: null };

export function render() { state.rev++; for (const l of listeners) l(state.rev); }
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => { listeners.add(set); return () => listeners.delete(set); }, []);
  return state;
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) {
    toast('Could not save: storage is full. Export a backup and delete old projects.', 'error');
    return false;
  }
}
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export function listProjects() {
  try { return JSON.parse(safeGet(IDX) || '[]'); } catch { return []; }
}
function writeIndex(list) { safeSet(IDX, JSON.stringify(list)); }

let saveTimer = null;
export function saveNow() {
  clearTimeout(saveTimer);
  const p = state.project;
  if (!p) return;
  p.updated = Date.now();
  if (!safeSet(PKEY(p.id), JSON.stringify(p))) return;
  const list = listProjects().filter((x) => x.id !== p.id);
  list.unshift({ id: p.id, name: p.name, updated: p.updated, count: p.entities.length, ns: p.namespace });
  writeIndex(list);
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 450); }

export function openProject(id) {
  const raw = safeGet(PKEY(id));
  if (!raw) { toast('That project could not be found.', 'error'); return false; }
  try {
    state.project = migrateProject(JSON.parse(raw));
  } catch (e) { toast('Project data is damaged: ' + e.message, 'error'); return false; }
  undoStack.length = 0; redoStack.length = 0;
  go({ screen: 'project' });
  return true;
}
export function setProject(p) {
  state.project = p;
  undoStack.length = 0; redoStack.length = 0;
  saveNow();
}
export function deleteProject(id) {
  safeDel(PKEY(id));
  writeIndex(listProjects().filter((x) => x.id !== id));
  if (state.project?.id === id) state.project = null;
  render();
}

/**
 * Mutate the project. `key` groups rapid edits (typing) into one undo step.
 */
export function commit(fn, key = null) {
  const p = state.project;
  if (!p) return;
  const now = Date.now();
  if (!(key && key === lastCommit.key && now - lastCommit.t < 1200)) {
    undoStack.push(JSON.stringify(p));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  lastCommit = { t: now, key };
  fn(p);
  for (const e of p.entities) if (e.model?.autoUv) packUVs(e.model);
  scheduleSave();
  render();
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state.project));
  state.project = JSON.parse(undoStack.pop());
  lastCommit = { t: 0, key: null };
  scheduleSave(); render();
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state.project));
  state.project = JSON.parse(redoStack.pop());
  lastCommit = { t: 0, key: null };
  scheduleSave(); render();
}

const history = [];
export function go(route, opts = {}) {
  if (!opts.replace) history.push({ route: state.route, entityUid: state.entityUid, tab: state.tab });
  state.route = route;
  if (route.entityUid) state.entityUid = route.entityUid;
  if (route.tab) state.tab = route.tab;
  else if (route.screen === 'entity' && !opts.keepTab) state.tab = 'overview';
  window.scrollTo?.(0, 0);
  render();
}
/** Returns true if something was handled (closed a modal or went back). */
export function back() {
  if (state.modal) { state.modal = null; render(); return true; }
  const prev = history.pop();
  if (!prev) {
    if (state.route.screen === 'home') return false;
    state.route = { screen: state.route.screen === 'entity' ? 'project' : 'home' };
    render();
    return true;
  }
  saveNow();
  state.route = prev.route; state.entityUid = prev.entityUid; state.tab = prev.tab;
  render();
  return true;
}
export function setTab(tab) { state.tab = tab; window.scrollTo?.(0, 0); render(); }

let toastId = 0;
export function toast(msg, kind = 'info', ms = 3200) {
  const id = ++toastId;
  state.toasts = [...state.toasts, { id, msg, kind }];
  render();
  setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id); render(); }, ms);
}
export function openModal(m) { state.modal = m; render(); }
export function closeModal() { state.modal = null; render(); }

export const currentEntity = () => state.project?.entities.find((e) => e.uid === state.entityUid) || null;
