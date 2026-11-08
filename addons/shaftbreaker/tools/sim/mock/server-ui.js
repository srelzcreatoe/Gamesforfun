// server-ui mock: forms resolve as cancelled (no UI in simulation)
class Base { title() { return this; } body() { return this; } button() { return this; } button1() { return this; } button2() { return this; } toggle() { return this; } dropdown() { return this; } slider() { return this; } textField() { return this; } submitButton() { return this; } label() { return this; } header() { return this; } divider() { return this; } async show() { return { canceled: true, cancelationReason: 'UserClosed' }; } }
export class ActionFormData extends Base {}
export class ModalFormData extends Base {}
export class MessageFormData extends Base {}
