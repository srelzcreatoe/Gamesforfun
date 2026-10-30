// Content-log output.  Debug lines are off unless an operator enables them.
let debug = false;
export const setDebug = (v) => {
  debug = !!v;
};
export const isDebug = () => debug;
export function dlog(...parts) {
  if (debug) console.warn("[Tailwail] " + parts.join(" "));
}
export function warn(...parts) {
  console.warn("[Tailwail] " + parts.join(" "));
}
export function errorText(e) {
  return e && e.stack ? `${e}\n${e.stack}` : String(e);
}
