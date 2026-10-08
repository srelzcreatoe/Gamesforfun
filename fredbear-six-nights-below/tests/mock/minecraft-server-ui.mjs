// Headless stand-in for `@minecraft/server-ui` 2.2.0 (integration tests only).
// Forms are recorded; the test decides each answer through `uiMock.respond`.
// Default answer: the player closed the form (canceled, UserClosed).

export const FormCancelationReason = Object.freeze({ UserBusy: 'UserBusy', UserClosed: 'UserClosed' });

export const uiMock = {
  shown: [],
  /** (form) => response object; return undefined for "closed". */
  respond: () => undefined,
  reset() {
    this.shown = [];
    this.respond = () => undefined;
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
