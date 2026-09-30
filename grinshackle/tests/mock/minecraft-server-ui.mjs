// Mock of @minecraft/server-ui 2.0.0 forms. show() resolves with the next queued response from the harness (or canceled).
import { __state, __log } from './minecraft-server.mjs';
export const FormCancelationReason = Object.freeze({ UserBusy: 'UserBusy', UserClosed: 'UserClosed' });
function next(kind, form) {
  const q = __state.formQueue.shift();
  __log('formShown', { formKind: kind, title: form.__title, buttons: form.__buttons ? form.__buttons.map((b) => b.text) : undefined, rows: form.__rows });
  if (!q) return { canceled: true, cancelationReason: 'UserClosed' };
  if (q.canceled) return { canceled: true, cancelationReason: 'UserClosed' };
  return { canceled: false, selection: q.selection, formValues: q.formValues };
}
export class ActionFormData {
  constructor() { this.__buttons = []; this.__title = ''; }
  title(t) { this.__title = String(t); return this; } body(b) { this.__body = String(b); return this; }
  button(text, icon) { this.__buttons.push({ text: String(text), icon }); return this; }
  divider() { return this; } header() { return this; } label() { return this; }
  show(player) { return Promise.resolve(next('action', this)); }
}
export class ModalFormData {
  constructor() { this.__rows = []; this.__title = ''; }
  title(t) { this.__title = String(t); return this; }
  toggle(label, opts) { this.__rows.push({ type: 'toggle', label: String(label), ...opts }); return this; }
  slider(label, min, max, opts) { this.__rows.push({ type: 'slider', label: String(label), min, max, ...opts }); return this; }
  dropdown(label, items, opts) { this.__rows.push({ type: 'dropdown', label: String(label), items, ...opts }); return this; }
  textField(label, placeholder, opts) { this.__rows.push({ type: 'text', label: String(label), placeholder, ...opts }); return this; }
  submitButton(t) { this.__submit = String(t); return this; }
  divider() { this.__rows.push({ type: 'divider' }); return this; } header(t) { this.__rows.push({ type: 'header', label: String(t) }); return this; } label(t) { this.__rows.push({ type: 'label', label: String(t) }); return this; }
  show(player) { return Promise.resolve(next('modal', this)); }
}
export class MessageFormData {
  constructor() { this.__title = ''; }
  title(t) { this.__title = String(t); return this; } body(b) { this.__body = String(b); return this; }
  button1(t) { this.__b1 = String(t); return this; } button2(t) { this.__b2 = String(t); return this; }
  show(player) { return Promise.resolve(next('message', this)); }
}
export class FormRejectError extends Error {}
export const uiManager = { closeAllForms() {} };
