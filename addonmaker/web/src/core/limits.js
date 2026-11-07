// "How many can exist at once" for any mob (dwellers default to exactly one).
// Exported as a behavior-pack function run every tick from functions/tick.json:
// the copies already in the world each hold a numbered slot tag; any extra copy
// (natural spawn, spawn egg, /summon) gets no slot and is removed at once with
// an instant-despawn event, so no loot or death sound. Once a second, slots that
// two copies share (e.g. one came back from an unloaded chunk) are fixed.
import { hashStr } from './util.js';

export const LIMIT_CHOICES = [0, 1, 2, 3, 5];
export const defaultLimit = () => ({ on: false, max: 1 });

export const limitEvent = (ns) => `${ns}:limit_remove`;
export const limitGroup = (ns) => `${ns}:limit_remove`;
const h36 = (s, m = 1e6) => (hashStr(s) % m).toString(36);
export const limitTag = (ns, name, i) => `ml${h36(`${ns}:${name}`, 1e8)}_${i}`;
export const limitObjective = (ns) => `ms_lim_${h36(ns)}`;

export function limitOf(e) {
  const l = e.limit;
  if (!l?.on) return 0;
  return Math.max(1, Math.min(10, Math.round(Number(l.max) || 1)));
}

/** Adds the removal group and event to an entity that has a limit. */
export function addLimitParts(ns, e, groups, events, notes) {
  const n = limitOf(e);
  if (!n) return false;
  groups[limitGroup(ns)] = { 'minecraft:instant_despawn': {} };
  events[limitEvent(ns)] = { add: { component_groups: [limitGroup(ns)] } };
  notes?.push(`Only ${n} at once → slot tags in functions/${ns}/limits.mcfunction plus the ${limitEvent(ns)} event`);
  return true;
}

/** functions/<ns>/limits*.mcfunction for every limited entity (empty if none). */
export function limitFunctions(ns, entities) {
  const limited = entities.filter((e) => limitOf(e));
  if (!limited.length) return [];
  const obj = limitObjective(ns);
  const tick = [`scoreboard objectives add ${obj} dummy`];
  const second = [`scoreboard players set #clock ${obj} 0`];
  for (const e of limited) {
    const id = `${ns}:${e.name}`, n = limitOf(e);
    const tags = Array.from({ length: n }, (_, i) => limitTag(ns, e.name, i + 1));
    const free = tags.map((t) => `tag=!${t}`).join(',');
    tick.push(`# ${id}: at most ${n} at once. The ones already in the world stay; extra copies are removed.`);
    for (const t of tags) tick.push(`execute unless entity @e[type=${id},tag=${t}] run tag @e[type=${id},${free},c=1] add ${t}`);
    tick.push(`execute if entity @e[type=${id},${free}] run event entity @e[type=${id},${free}] ${limitEvent(ns)}`);
    for (const t of tags) {
      second.push(`scoreboard players set #n ${obj} 0`);
      second.push(`execute as @e[type=${id},tag=${t}] run scoreboard players add #n ${obj} 1`);
      second.push(`execute if score #n ${obj} matches 2.. run tag @e[type=${id},tag=${t},c=1] remove ${t}`);
    }
  }
  tick.push(`scoreboard players add #clock ${obj} 1`);
  tick.push(`execute if score #clock ${obj} matches 20.. run function ${ns}/limits_second`);
  return [
    { path: `functions/${ns}/limits.mcfunction`, data: tick.join('\n') + '\n' },
    { path: `functions/${ns}/limits_second.mcfunction`, data: second.join('\n') + '\n' },
  ];
}
