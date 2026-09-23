// Delayed callbacks that master-OFF can cancel. Every callback re-checks the gates when it fires.
import { S } from './state.js';
import { safe, logError } from './util.js';

const pending = [];
let nextId = 1;
const MAX_PENDING = 64;

/** Schedule fn to run in `ticks` ticks. tag 'system' callbacks run even while master is OFF. Returns id or -1 if the queue is full. */
export function schedule(ticks, fn, tag = 'encounter') {
  if (pending.length >= MAX_PENDING) return -1;
  const id = nextId++;
  pending.push({ id, at: S.tick + Math.max(1, Math.floor(ticks)), fn, tag });
  return id;
}
export function cancel(id) {
  const i = pending.findIndex((p) => p.id === id);
  if (i >= 0) pending.splice(i, 1);
}
export function cancelTag(tag) {
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].tag === tag) pending.splice(i, 1);
}
export function cancelAll() { pending.length = 0; }
export function pendingCount() { return pending.length; }

/** Called once per tick from main.js. */
export function pump(masterEnabled) {
  if (!pending.length) return;
  const due = [];
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= S.tick) due.push(pending.splice(i, 1)[0]);
  due.sort((a, b) => a.id - b.id);
  for (const p of due) {
    if (!masterEnabled && p.tag !== 'system') continue;
    try { p.fn(); } catch (e) { logError(e); }
  }
}
