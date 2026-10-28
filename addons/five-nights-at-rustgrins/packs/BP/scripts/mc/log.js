// Content-log helpers: everything is prefixed so it is easy to find in the
// creator content log. Errors never throw.

const P = '[FNaR]';

export const log = {
  info(msg) {
    console.log(`${P} ${msg}`);
  },
  warn(msg) {
    console.warn(`${P} ${msg}`);
  },
  error(msg, e) {
    console.error(`${P} ${msg}${e ? `: ${e?.message ?? e}${e?.stack ? `\n${e.stack}` : ''}` : ''}`);
  },
};
