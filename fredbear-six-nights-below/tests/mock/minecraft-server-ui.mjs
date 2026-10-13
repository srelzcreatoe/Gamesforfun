// Headless stand-in for `@minecraft/server-ui` 2.2.0 (integration tests only).
// Forms are recorded; the test decides each answer through `uiMock.respond`.
// Default answer: the player closed the form (canceled, UserClosed) - except the camera map form
// (title starting with the CAM_FORM_MARK, 1.6.2), which stays open like the real one until the test
// answers it (uiMock.answer) or the script closes it (uiManager.closeAllForms).

const CAM_FORM_MARK = '§k§r§k§r§m';

export const FormCancelationReason = Object.freeze({ UserBusy: 'UserBusy', UserClosed: 'UserClosed' });

export const uiMock = {
  shown: [],
  /** forms still open: { player, form, resolve } */
  pending: [],
  closedAll: 0,
  /** (form) => response object; return undefined for "closed". */
  respond: () => undefined,
  /** Answer the oldest form still open (e.g. { selection: 3 }, or { canceled: true, cancelationReason: 'UserClosed' }). */
  answer(response) {
    const p = this.pending.shift();
    if (p) p.resolve(response);
    return !!p;
  },
  reset() {
    this.shown = [];
    this.pending = [];
    this.respond = () => undefined;
  },
};

export const uiManager = {
  closeAllForms(player) {
    uiMock.closedAll++;
    const keep = [];
    for (const p of uiMock.pending) {
      if (p.player === player) p.resolve({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
      else keep.push(p);
    }
    uiMock.pending = keep;
  },
};

class Form {
  constructor(kind) {
    this.kind = kind;
    this.data = { title: '', body: '', buttons: [], controls: [] };
  }

  title(t) {
    this.data.title = String(t);
    return this;
  }

  body(t) {
    this.data.body = String(t);
    return this;
  }

  show(player) {
    uiMock.shown.push({ kind: this.kind, player: player?.name, ...this.data });
    const r = uiMock.respond({ kind: this.kind, ...this.data });
    if (!r && this.data.title.startsWith(CAM_FORM_MARK)) return new Promise((resolve) => uiMock.pending.push({ player, form: this.data, resolve }));
    return Promise.resolve(r ?? { canceled: true, cancelationReason: FormCancelationReason.UserClosed });
  }
}

export class ActionFormData extends Form {
  constructor() {
    super('action');
  }

  button(text) {
    this.data.buttons.push(String(text));
    return this;
  }
}

export class MessageFormData extends Form {
  constructor() {
    super('message');
  }

  button1(t) {
    this.data.buttons[0] = String(t);
    return this;
  }

  button2(t) {
    this.data.buttons[1] = String(t);
    return this;
  }
}

export class ModalFormData extends Form {
  constructor() {
    super('modal');
  }

  toggle(label, opts) {
    this.data.controls.push({ type: 'toggle', label, opts });
    return this;
  }

  slider(label, min, max, opts) {
    this.data.controls.push({ type: 'slider', label, min, max, opts });
    return this;
  }
}
