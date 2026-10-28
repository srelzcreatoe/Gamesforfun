// Content-log helpers: everything is prefixed so it is easy to find in the
// creator content log. Warnings and errors are also shown in chat (deduplicated,
// at most a few a minute) so a player can report what went wrong without
// opening the content log. Logging never throws.

import { system, world } from '@minecraft/server';

const P = '[FNaR]';
const CHAT_PER_MINUTE = 6;
const recent = new Map(); // message head -> tick last shown
let minute = -1;
let shown = 0;

function toChat(color, msg) {
  try {
    system.run(() => {
      try {
        const now = system.currentTick;
        const m = Math.floor(now / 1200);
        if (m !== minute) {
          minute = m;
          shown = 0;
        }
        const key = msg.slice(0, 80);
        if (now - (recent.get(key) ?? -1e9) < 1200 || shown >= CHAT_PER_MINUTE) return;
        recent.set(key, now);
        shown++;
        world.sendMessage(`§8${P} ${color}${msg.slice(0, 240)}`);
      } catch {
        // no world yet
      }
    });
  } catch {
    // ignore
  }
}

export const log = {
  info(msg) {
    console.log(`${P} ${msg}`);
  },
  warn(msg) {
    console.warn(`${P} ${msg}`);
    toChat('§e', msg);
  },
  error(msg, e) {
    console.error(`${P} ${msg}${e ? `: ${e?.message ?? e}${e?.stack ? `\n${e.stack}` : ''}` : ''}`);
    toChat('§c', `${msg}${e ? `: ${e?.message ?? e}` : ''}`);
  },
};
