// Logging to the content log (console.warn shows in Minecraft's content log)
// with a small ring buffer for /fb:debug state dumps.

const RING = [];
let verbose = false;

export function setVerbose(v) {
  verbose = !!v;
}

function push(level, msg) {
  RING.push(`[${level}] ${msg}`);
  if (RING.length > 200) RING.shift();
}

export const log = {
  info(msg) {
    push('info', msg);
    if (verbose) console.warn(`[FB] ${msg}`);
  },
  warn(msg) {
    push('warn', msg);
    console.warn(`[FB] WARN ${msg}`);
  },
  error(msg, e) {
    const text = e ? `${msg}: ${e?.message ?? e}` : msg;
    push('error', text);
    console.error(`[FB] ERROR ${text}`);
  },
  recent(n = 30) {
    return RING.slice(-n);
  },
};
