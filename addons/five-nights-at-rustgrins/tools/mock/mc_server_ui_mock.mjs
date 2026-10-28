// Mock of @minecraft/server-ui: forms resolve through mock.formPolicy so the
// driver can script answers (and record every form shown).
import { mock } from './mc_server_mock.mjs';

export const FormCancelationReason = Object.freeze({ UserBusy: 'UserBusy', UserClosed: 'UserClosed' });

class Base {
  constructor(kind) {
    this.kind = kind;
    this._title = '';
    this._body = '';
    this.buttons = [];
    this.controls = [];
  }

  title(t) { this._title = typeof t === 'string' ? t : JSON.stringify(t); return this; }
  body(t) { this._body = t; return this; }
  async show(player) {
    mock.forms.push({ kind: this.kind, title: this._title, buttons: this.buttons.length, controls: this.controls.length });
    const r = mock.formPolicy ? await mock.formPolicy(this, player) : { canceled: true, cancelationReason: 'UserClosed' };
    return r;
  }
}
export class ActionFormData extends Base {
  constructor() { super('action'); }
  button(text) { this.buttons.push(text); return this; }
}
export class MessageFormData extends Base {
  constructor() { super('message'); }
  button1(t) { this.buttons[0] = t; return this; }
  button2(t) { this.buttons[1] = t; return this; }
}
export class ModalFormData extends Base {
  constructor() { super('modal'); }
  toggle(label, o) { this.controls.push(['toggle', label, o?.defaultValue ?? false]); return this; }
  slider(label, min, max, o) {
    if (!(min < max)) throw new Error('slider min must be < max');
    this.controls.push(['slider', label, o?.defaultValue ?? min]);
    return this;
  }
  dropdown(label, opts, o) { this.controls.push(['dropdown', label, o?.defaultValueIndex ?? 0]); return this; }
  textField(label, ph, o) { this.controls.push(['text', label, o?.defaultValue ?? '']); return this; }
}
export const uiManager = { closeAllForms() { mock.closed = (mock.closed ?? 0) + 1; } };
