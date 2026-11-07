// Pre-export checks. Catches broken references and common mistakes that would
// otherwise only show up as content-log errors (or silent failures) in game.
import { isObj } from './util.js';
import { activityGroup } from './packgen.js';
import { modelBounds, faceRects } from './geo.js';
import { horrorNames, hProp } from './horror.js';

export const BUILTIN_EVENTS = ['minecraft:entity_spawned', 'minecraft:entity_born', 'minecraft:entity_transformed', 'minecraft:on_prime'];
const MOVE_GOALS = /behavior\.(random_stroll|random_swim|random_fly|random_hover|swim_wander|follow_|tempt|panic|move_|melee|stomp|delayed_attack|go_home|work|sleep|mingle|explore_outskirts|stroll_towards_village|defend_village_target|avoid_mob_type|flee_sun|breed|float_wander)/;
const ATTACK_GOALS = /behavior\.(melee_attack|melee_box_attack|ranged_attack|stomp_attack|delayed_attack|charge_attack|leap_at_target|slime_attack|ram_attack|swoop_attack|sonic_boom|knockback_roar|guardian_attack|aquatic_charge_attack)/;
const PLACEMENTS = ['minecraft:spawns_on_surface', 'minecraft:spawns_underground', 'minecraft:spawns_underwater', 'minecraft:spawns_lava'];

function walk(node, fn, path = []) {
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, fn, [...path, i]));
  else if (isObj(node)) {
    fn(node, path);
    for (const [k, v] of Object.entries(node)) walk(v, fn, [...path, k]);
  }
}

function collectEventRefs(components) {
  const refs = [];
  walk(components, (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'event' || k.endsWith('_event')) && typeof v === 'string' && v) {
        // breed/spawn events run on another entity; skip those keys.
        if (k === 'spawn_event' || k === 'breed_event') continue;
        refs.push({ name: v, target: o.target, where: path.join('.') });
      }
    }
  });
  return refs;
}

function walkActions(action, fn) {
  if (!isObj(action)) return;
  fn(action);
  for (const k of ['randomize', 'sequence']) if (Array.isArray(action[k])) action[k].forEach((a) => walkActions(a, fn));
}

const parensOk = (s) => {
  let d = 0;
  for (const c of String(s)) { if (c === '(') d++; else if (c === ')') { d--; if (d < 0) return false; } }
  return d === 0;
};

export function validateProject(project, catalog, vanilla) {
  const out = [];
  const add = (level, msg, e, tab) => out.push({ level, msg, e: e?.uid, entity: e?.name, tab });
  if (!project.name?.trim()) add('error', 'The project needs a name.', null, 'project');
  if (!/^[a-z0-9_]+$/.test(project.namespace || '')) add('error', `Namespace "${project.namespace}" may only use a-z, 0-9 and _.`, null, 'project');
  if (['minecraft', 'minecon'].includes(project.namespace)) add('error', 'The namespace "minecraft" is reserved. Pick your own (for example your name).', null, 'project');
  if (!project.entities.length) add('error', 'Add at least one entity before exporting.', null, 'project');
  const sn = new Set();
  for (const cs of project.sounds || []) {
    if (!/^[a-z0-9_]+$/.test(cs.name || '')) add('error', `Custom sound name "${cs.name}" may only use a-z, 0-9 and _.`, null, 'project');
    if (sn.has(cs.name)) add('error', `Two custom sounds are named "${cs.name}".`, null, 'project');
    sn.add(cs.name);
  }
  const names = new Set();
  for (const e of project.entities) {
    if (names.has(e.name)) add('error', `Two entities are both named "${e.name}".`, e, 'overview');
    names.add(e.name);
    validateEntity(project, e, catalog, vanilla, add);
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

function validateEntity(project, e, catalog, vanilla, add) {
  const ns = project.namespace;
  if (!/^[a-z0-9_]+$/.test(e.name)) add('error', `Entity id "${e.name}" may only use a-z, 0-9 and _.`, e, 'overview');
  if (!e.displayName?.trim()) add('warn', 'Give it a display name (shown on the spawn egg and name tags).', e, 'overview');

  const comps = catalog?.components || {};
  const all = [{ where: 'Components', c: e.components }, ...e.groups.map((g) => ({ where: `Group ${g.name}`, c: g.components }))];
  for (const a of e.schedule?.enabled ? e.schedule.activities : []) all.push({ where: `Activity ${a.name}`, c: a.components });
  const anywhere = (id) => all.some((x) => x.c[id]);

  for (const { where, c } of all) {
    for (const [id, v] of Object.entries(c)) {
      if (!comps[id]) add('warn', `${where}: "${id}" isn't a component this game version knows. It will be ignored.`, e, 'components');
      else if (id.startsWith('minecraft:player.')) add('warn', `${where}: ${id} only works on players.`, e, 'components');
      if (id.startsWith('minecraft:behavior.') && (!isObj(v) || typeof v.priority !== 'number')) add('warn', `${where}: ${id} has no priority. Lower numbers run first; set one so goals don't fight.`, e, 'components');
      if (!isObj(v) && !Array.isArray(v)) add('error', `${where}: ${id} must be a JSON object.`, e, 'components');
    }
  }
  if (!anywhere('minecraft:collision_box')) add('warn', 'No collision box: the entity will be 0×0 and hard to hit.', e, 'overview');
  if (!anywhere('minecraft:health') && !anywhere('minecraft:projectile')) add('info', 'No health set; it will use the game default.', e, 'overview');
  const ids = all.flatMap((x) => Object.keys(x.c));
  if (ids.some((id) => MOVE_GOALS.test(id))) {
    if (!anywhere('minecraft:movement')) add('error', 'It has movement goals but no minecraft:movement speed, so it will never move.', e, 'components');
    if (!ids.some((id) => id.startsWith('minecraft:navigation.'))) add('warn', 'Movement goals need a navigation component (e.g. minecraft:navigation.walk) to find paths.', e, 'components');
    if (!ids.some((id) => id.startsWith('minecraft:movement.'))) add('warn', 'Movement goals need a movement type (e.g. minecraft:movement.basic).', e, 'components');
  }
  if (ids.some((id) => /behavior\.(melee_attack|melee_box_attack)/.test(id)) && !anywhere('minecraft:attack')) add('warn', 'It has a melee attack goal but no minecraft:attack damage.', e, 'components');
  if (ids.includes('minecraft:behavior.ranged_attack') && !anywhere('minecraft:shooter')) add('error', 'Ranged attack needs minecraft:shooter (what to shoot).', e, 'components');
  if (ids.some((id) => /nearest_attackable_target|hurt_by_target|defend_village_target/.test(id)) && !ids.some((id) => ATTACK_GOALS.test(id))) add('warn', 'It picks targets but has no attack goal, so it will just stare at them.', e, 'components');
  const tame = all.map((x) => x.c['minecraft:tameable']).find(Boolean);
  if (tame && !tame.tame_event) add('warn', 'Tameable has no tame event, so nothing changes after taming.', e, 'components');
  if (tame && !(Array.isArray(tame.tame_items) ? tame.tame_items.length : tame.tame_items)) add('warn', 'Tameable has no tame items.', e, 'components');
  const breed = all.map((x) => x.c['minecraft:breedable']).find(Boolean);
  if (breed && !anywhere('minecraft:behavior.breed')) add('warn', 'Breedable entities also need the minecraft:behavior.breed goal to find a mate.', e, 'components');
  if (breed && !breed.breed_items) add('warn', 'Breedable has no breed items.', e, 'components');
  const ride = all.map((x) => x.c['minecraft:rideable']).find(Boolean);
  if (ride && anywhere('minecraft:input_ground_controlled') === false) add('info', 'Riders can sit on it but not steer. Add minecraft:input_ground_controlled to steer.', e, 'components');
  if (anywhere('minecraft:dweller')) {
    const d = all.map((x) => x.c['minecraft:dweller']).find(Boolean);
    if (d.dweller_role === 'defender' && !anywhere('minecraft:behavior.defend_village_target')) add('info', 'Defender dwellers usually have minecraft:behavior.defend_village_target.', e, 'dweller');
    if (!anywhere('minecraft:behavior.move_towards_dwelling_restriction')) add('info', 'Dwellers usually have move_towards_dwelling_restriction so they stay in their village.', e, 'dweller');
  }

  // Component groups and events.
  const groupNames = new Set(e.groups.map((g) => g.name));
  if (e.schedule?.enabled) for (const a of e.schedule.activities) groupNames.add(activityGroup(project, a.name));
  const hn = horrorNames(ns, e.horror);
  for (const g of hn.groups) groupNames.add(g);
  const seenG = new Set();
  for (const g of e.groups) {
    if (!g.name) add('error', 'A component group has no name.', e, 'groups');
    if (seenG.has(g.name)) add('error', `Two component groups are named "${g.name}".`, e, 'groups');
    seenG.add(g.name);
  }
  const eventNames = new Set(e.events.map((x) => x.name));
  if (e.schedule?.enabled) for (const a of e.schedule.activities) eventNames.add(`${ns}:schedule_${a.name}`);
  for (const ev of hn.events) eventNames.add(ev);
  const usedGroups = new Set();
  const propNames = new Set(e.properties.map((p) => p.name));
  if (e.horror?.enabled) propNames.add(hProp(ns));
  const seenE = new Set();
  for (const ev of e.events) {
    if (!ev.name) add('error', 'An event has no name.', e, 'events');
    if (seenE.has(ev.name)) add('error', `Two events are named "${ev.name}".`, e, 'events');
    seenE.add(ev.name);
    if (!Object.keys(ev.action || {}).length) add('warn', `Event ${ev.name} does nothing yet.`, e, 'events');
    walkActions(ev.action, (a) => {
      for (const k of ['add', 'remove']) for (const g of a[k]?.component_groups || []) {
        usedGroups.add(g);
        if (!groupNames.has(g)) add('error', `Event ${ev.name} ${k === 'add' ? 'adds' : 'removes'} group "${g}", which doesn't exist.`, e, 'events');
      }
      const tr = typeof a.trigger === 'string' ? a.trigger : a.trigger?.event;
      if (tr && !eventNames.has(tr) && !BUILTIN_EVENTS.includes(tr)) add('warn', `Event ${ev.name} triggers "${tr}", which isn't defined on this entity.`, e, 'events');
      for (const [pn, pv] of Object.entries(a.set_property || {})) {
        if (!propNames.has(pn)) add('error', `Event ${ev.name} sets property "${pn}", which isn't defined (Properties tab).`, e, 'events');
        if (typeof pv === 'string' && !parensOk(pv)) add('error', `Event ${ev.name}: Molang for ${pn} has unbalanced parentheses.`, e, 'events');
      }
      const cmd = a.queue_command?.command;
      if (a.queue_command && !(Array.isArray(cmd) ? cmd.length : cmd)) add('warn', `Event ${ev.name} has an empty command.`, e, 'events');
    });
  }
  for (const g of e.groups) if (!usedGroups.has(g.name) && !(e.schedule?.enabled)) add('info', `Group ${g.name} is never added by an event, so it never turns on.`, e, 'groups');
  for (const { where, c } of all) {
    for (const r of collectEventRefs(c)) {
      if (eventNames.has(r.name) || BUILTIN_EVENTS.includes(r.name)) continue;
      if (r.target && r.target !== 'self') continue;
      add(r.name.startsWith(ns + ':') ? 'error' : 'warn', `${where}: refers to event "${r.name}", which isn't defined.`, e, 'events');
    }
    walk(c, (o) => {
      if (typeof o.test === 'string' && catalog?.filters && !catalog.filters[o.test]) add('warn', `${where}: unknown filter test "${o.test}".`, e, 'components');
      if ((o.test === 'int_property' || o.test === 'bool_property' || o.test === 'enum_property' || o.test === 'float_property') && o.domain && o.domain.startsWith(ns + ':') && !propNames.has(o.domain)) add('error', `${where}: filter checks property "${o.domain}", which isn't defined.`, e, 'properties');
    });
  }

  // Properties.
  if (e.properties.length > 32) add('error', 'Entities can have at most 32 properties.', e, 'properties');
  for (const p of e.properties) {
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(p.name || '')) add('error', `Property "${p.name}" must look like ${ns}:my_property.`, e, 'properties');
    else if (p.name.startsWith('minecraft:')) add('error', `Property "${p.name}" can't use the minecraft namespace.`, e, 'properties');
    if (p.type === 'enum') {
      const vals = (p.values || []).filter(Boolean);
      if (!vals.length) add('error', `Enum property ${p.name} needs at least one value.`, e, 'properties');
      if (vals.some((v) => !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(v))) add('error', `Enum values for ${p.name} must be letters, digits or _ (max 32 chars).`, e, 'properties');
      if (vals.length && !vals.includes(p.def)) add('warn', `Default "${p.def}" of ${p.name} isn't one of its values; the first value will be used.`, e, 'properties');
    }
    if ((p.type === 'int' || p.type === 'float') && Number(p.range?.[0]) > Number(p.range?.[1])) add('error', `Property ${p.name}: range min is above max.`, e, 'properties');
  }

  // Model and textures.
  const m = e.model;
  const bn = new Set();
  let cubes = 0;
  for (const b of m.bones) {
    if (!b.name) add('error', 'A bone has no name.', e, 'model');
    if (bn.has(b.name)) add('error', `Two bones are named "${b.name}".`, e, 'model');
    bn.add(b.name);
    cubes += b.cubes.length;
  }
  for (const b of m.bones) {
    if (b.parent && !bn.has(b.parent)) add('error', `Bone ${b.name} has missing parent "${b.parent}".`, e, 'model');
    let p = b, guard = 0;
    while (p && p.parent && guard++ < 64) p = m.bones.find((x) => x.name === p.parent);
    if (guard >= 64) add('error', `Bone ${b.name} is part of a parent loop.`, e, 'model');
    for (const c of b.cubes) {
      if (c.size.some((v) => v < 0)) add('error', `Bone ${b.name} has a cube with a negative size.`, e, 'model');
      const r = faceRects(c);
      const right = Math.max(...Object.values(r).map((f) => f.x + f.w)), bottom = Math.max(...Object.values(r).map((f) => f.y + f.h));
      if (right > m.texW + 0.01 || bottom > m.texH + 0.01) add('warn', `Bone ${b.name}: a cube's UV goes outside the ${m.texW}×${m.texH} texture. Use Auto UV or enlarge the texture.`, e, 'model');
    }
  }
  if (!cubes && !all.some((x) => x.c['minecraft:projectile'])) add('error', 'The model has no cubes, so the entity will be invisible.', e, 'model');
  const { max } = modelBounds(m);
  if (max[1] > 16 * 16) add('warn', 'The model is taller than 16 blocks and may be culled.', e, 'model');
  if (e.anims?.look?.on && !m.bones.some((b) => b.role === 'head')) add('info', 'Look-at is on but no bone has the Head role.', e, 'animations');
  for (const ca of e.anims?.custom || []) {
    for (const ch of ca.channels || []) if (ch.bone && !bn.has(ch.bone)) add('error', `Animation ${ca.name} moves bone "${ch.bone}", which doesn't exist.`, e, 'animations');
    if (ca.when === 'custom' && !parensOk(ca.expr || '')) add('error', `Animation ${ca.name}: Molang condition has unbalanced parentheses.`, e, 'animations');
  }
  if ((e.textures?.length || 0) > 1) {
    const q = { variant: 'minecraft:variant', mark_variant: 'minecraft:mark_variant', skin_id: 'minecraft:skin_id' }[e.textureSelector || 'variant'];
    if (!anywhere(q)) add('warn', `You have ${e.textures.length} skins but no ${q} component picks one; it will always show the first skin.`, e, 'texture');
  }

  // Spawning.
  if (e.spawn?.enabled) {
    if (!e.spawn.conditions?.length) add('error', 'Natural spawning is on but has no conditions.', e, 'spawn');
    e.spawn.conditions?.forEach((c, i) => {
      if (!PLACEMENTS.some((p) => c[p])) add('error', `Spawn condition ${i + 1} needs a place (surface, underground, underwater or lava).`, e, 'spawn');
      const br = c['minecraft:brightness_filter'];
      if (br && br.min > br.max) add('error', `Spawn condition ${i + 1}: brightness min is above max.`, e, 'spawn');
      const h = c['minecraft:herd'];
      if (h && h.min_size > h.max_size) add('error', `Spawn condition ${i + 1}: herd min is above max.`, e, 'spawn');
      if (!c['minecraft:weight']) add('info', `Spawn condition ${i + 1} has no weight; it will be rare.`, e, 'spawn');
    });
  }
  // Loot / gear / trades.
  if (e.loot?.enabled) {
    if (!e.loot.pools?.length) add('warn', 'Loot is on but has no pools.', e, 'loot');
    e.loot.pools?.forEach((p, i) => (p.entries || []).forEach((en) => {
      if ((en.type || 'item') === 'item' && !en.name) add('error', `Loot pool ${i + 1} has an item entry with no item.`, e, 'loot');
      if (vanilla && en.name && en.name.startsWith('minecraft:') && !vanilla.items.includes(en.name)) add('warn', `Loot item "${en.name}" isn't a known vanilla item.`, e, 'loot');
    }));
  }
  if (e.trades?.enabled) {
    const trades = (e.trades.tiers || []).flatMap((t) => (t.groups || []).flatMap((g) => g.trades || []));
    if (!trades.length) add('warn', 'Trading is on but there are no trades.', e, 'trades');
    for (const t of trades) for (const it of [...(t.wants || []), ...(t.gives || [])]) if (!it.item) add('error', 'A trade has an item slot with no item.', e, 'trades');
  }
  // Schedule.
  if (e.schedule?.enabled) {
    const acts = new Set(e.schedule.activities.map((a) => a.name));
    if (!e.schedule.slots?.length) add('warn', 'The daily schedule has no time slots.', e, 'dweller');
    for (const s of e.schedule.slots || []) if (!acts.has(s.activity)) add('error', `Schedule slot uses missing activity "${s.activity}".`, e, 'dweller');
    for (const a of e.schedule.activities) if (!/^[a-z0-9_]+$/.test(a.name)) add('error', `Activity name "${a.name}" may only use a-z, 0-9 and _.`, e, 'dweller');
    const sl = [...(e.schedule.slots || [])].filter((s) => s.from < s.to).sort((a, b) => a.from - b.from);
    for (let i = 1; i < sl.length; i++) if (sl[i].from < sl[i - 1].to) add('warn', 'Two schedule slots overlap; the later one wins while both match.', e, 'dweller');
  }
  // Horror dweller.
  const h = e.horror;
  if (h?.enabled) {
    if (h.senses.seen === 'freeze' && h.stalk.on) add('info', 'Freeze-when-seen works best with stalking off (it hunts while unseen instead).', e, 'dweller');
    if (!h.stalk.on && !h.hunt.onClose && !h.hunt.onHurt && !['charge', 'freeze'].includes(h.senses.seen)) add('warn', 'Nothing ever makes this horror dweller hunt. Turn on a hunt trigger.', e, 'dweller');
    if (Number(h.hunt.close) >= Number(h.senses.detect)) add('warn', 'Hunt distance is larger than its detection range.', e, 'dweller');
    if (h.stalk.on && Number(h.stalk.keep) >= Number(h.senses.detect)) add('warn', 'Stalking distance is larger than its detection range, so it will never get close.', e, 'dweller');
    if (e.properties.some((p) => p.name === hProp(ns))) add('error', `Property ${hProp(ns)} is reserved for the horror AI.`, e, 'properties');
    if (e.groups.some((g) => hn.groups.includes(g.name))) add('error', 'One of your groups uses a name reserved for the horror AI (…:horror_*).', e, 'groups');
    if (e.events.some((x) => hn.events.includes(x.name))) add('error', 'One of your events uses a name reserved for the horror AI (…:horror_*).', e, 'events');
    for (const s of [h.scares.screamSound, h.scares.heartbeatSound, h.scares.seenSound]) {
      if (s && vanilla?.sounds?.length && !vanilla.sounds.includes(s) && !(project.sounds || []).some((cs) => `${ns}.${cs.name}` === s)) add('warn', `Scare sound "${s}" isn't a vanilla or custom sound.`, e, 'dweller');
    }
  }

  // Sounds.
  if (e.sounds?.enabled && vanilla?.sounds?.length) {
    for (const [k, v] of Object.entries(e.sounds.events || {})) if (v?.sound && !vanilla.sounds.includes(v.sound) && !(project.sounds || []).some((cs) => `${ns}.${cs.name}` === v.sound)) add('warn', `Sound "${v.sound}" (${k}) isn't a vanilla sound or one of your custom sounds.`, e, 'sounds');
  }
}
