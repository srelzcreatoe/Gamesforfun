// @ts-check
/**
 * THE SHAFTBREAKER - adaptive cave dweller (Minecraft Bedrock, stable Script API, no experiments).
 * Entry point: event wiring, loops, commands.
 */
import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';
import { loadConfig, config, setConfig, applyPreset, ENUMS, DEFAULTS, prefs } from './core/config.js';
import { safe, valid, now, sec, mins, rand, isOperator, worldTicks, OVERWORLD, reportError, chance } from './core/util.js';
import { recent, log } from './core/log.js';
import { isWoodenDoorId } from './core/blocks.js';
import { loadPlaced, notePlaced, noteRemoved, savePlaced, placedCount } from './world/protection.js';
import { isUnderground } from './world/space.js';
import { onDenHeartBroken } from './world/den.js';
import { SB_ID, creature, tickCreature, adopt, despawnAll, onDefeat, dropLoot } from './ai/creature.js';
import { onPlayerHitMob, directorTick, fastTick, slowTick, onBreak, onPlace, onDoorUse, onPlayerDeath, onPlayerSpawn, onCreatureHurtByPlayer, armRetaliation, dropPlayer, forceEncounter, stopEncounter, debugLine, pstate, TEMPLATES, running } from './ai/director.js';
import { profile, evidence, markDirty, resetProfile } from './ai/memory.js';
import { ws, wsDirty, wsReset } from './ai/worldstate.js';
import { openDial } from './ui.js';
import { presenceAudio } from './ai/brain.js';
import { playFor, forgetAudio, stopAllMusic, tickHeart } from './audio.js';

let inited = false;

function init() {
  if (inited) return;
  inited = true;
  safe('config', loadConfig);
  safe('placed', loadPlaced);
  safe('ws', ws);
  // no orphan creature survives a reload: the director re-creates encounters from scratch
  safe('sweep', () => despawnAll(true));
  for (const p of world.getAllPlayers()) safe('untag', () => p.removeTag('sb_target'));
  system.runInterval(() => safe('fast', () => { tickCreature(); fastTick(); }), 1);
  system.runInterval(() => safe('director', directorTick), 40);
  system.runInterval(() => safe('slow', () => { slowTick(); savePlaced(); }), 600);
  system.runInterval(() => safe('trophy', trophyTick), 40);
  system.runInterval(() => safe('presence', presenceAudio), 20);
  system.runInterval(() => safe('heart', () => { for (const p of world.getAllPlayers()) tickHeart(p); }), 5);
  system.runInterval(() => safe('debug', debugTick), 10);
  console.warn(`[Shaftbreaker] ready (preset=${config().preset}, templates=${TEMPLATES.length}, placed-registry=${placedCount()})`);
}

// ------------------------------------------------------------------ startup
safe('startup', () => {
  system.beforeEvents.startup.subscribe((ev) => {
    safe('commands', () => registerCommands(ev.customCommandRegistry));
  });
});
safe('worldLoad', () => world.afterEvents.worldLoad.subscribe(() => init()));
system.runTimeout(() => { try { world.getDynamicProperty('sb:config'); init(); } catch { /* not ready */ } }, 40);

// ------------------------------------------------------------------ world events
world.afterEvents.playerBreakBlock.subscribe((ev) => safe('break', () => {
  const p = ev.player;
  const id = ev.brokenBlockPermutation.type.id;
  noteRemoved(ev.block.location);
  if (p.dimension.id !== OVERWORLD) return;
  onBreak(p, ev.block.location);
  if (id === 'shaftbreaker:den_heart') onDenHeartBroken(p, ev.block.location, (at) => armRetaliation(p, at));
}));

world.afterEvents.playerPlaceBlock.subscribe((ev) => safe('place', () => {
  notePlaced(ev.block.location);
  onPlace(ev.player, ev.block.location, ev.block.typeId);
}));

world.afterEvents.playerInteractWithBlock.subscribe((ev) => safe('interact', () => {
  if (ev.isFirstEvent && isWoodenDoorId(ev.block.typeId)) onDoorUse(ev.player);
}));

world.afterEvents.entityHurt.subscribe((ev) => safe('hurt', () => {
  const e = ev.hurtEntity;
  if (e.typeId === SB_ID) {
    const src = ev.damageSource;
    const by = src.damagingEntity;
    if (by && by.typeId === 'minecraft:player') {
      onCreatureHurtByPlayer(/** @type {any} */ (by), ev.damage);
      const c = creature();
      if (c && ev.damage >= 7 && !c.act && chance(0.5)) {              // N27 twisted recovery after heavy knockback
        c.setAct(chance(0.5) ? 25 : 26);
      }
    } else if (!by || by.typeId !== SB_ID) {
      // trap learning (N17/L51): the same hazard hurting it repeatedly
      const cause = String(src.cause);
      const near = world.getAllPlayers().filter((p) => p.dimension.id === e.dimension.id && p.location && Math.abs(p.location.x - e.location.x) < 32 && Math.abs(p.location.z - e.location.z) < 32);
      for (const p of near) {
        const pf = profile(p);
        pf.traps[cause] = (pf.traps[cause] || 0) + 1;
        if (pf.traps[cause] >= 2) evidence(p, 'trap_reuse', 0.8, `${cause} trap again`);
        markDirty(p);
      }
    }
  }
  const by2 = ev.damageSource.damagingEntity;
  if (e.typeId !== SB_ID && e.typeId !== 'minecraft:player' && by2 && by2.typeId === 'minecraft:player') onPlayerHitMob(/** @type {any} */ (by2));
  if (e.typeId === 'minecraft:player' && ev.damageSource.damagingEntity?.typeId === SB_ID) {
    const s = pstate(/** @type {any} */ (e));
    s.lastHurtBy = now();
    const c = creature(); if (c) c.lastEngineHit = now();
  }
}));

world.afterEvents.entityDie.subscribe((ev) => safe('die', () => {
  const e = ev.deadEntity;
  if (e.typeId === 'minecraft:player') { onPlayerDeath(/** @type {any} */ (e)); return; }
  if (e.typeId === SB_ID) {
    // a vanilla death (one huge hit) still counts as a defeat and still drops the trophy
    safe('vanillaDefeat', () => { if (config().trophyDrop) dropLoot(e.dimension, e.location); });
    markDefeat(ev.damageSource.damagingEntity);
  }
}));

world.afterEvents.dataDrivenEntityTrigger.subscribe((ev) => safe('trigger', () => {
  if (ev.eventId === 'sb:defeated' && ev.entity.typeId === SB_ID) { const c = creature(); if (c) c.beginDefeat(); }
}), { entityTypes: [SB_ID], eventTypes: ['sb:defeated'] });

onDefeat((c) => {
  const run = running();
  const by = run ? run.ctx.player : null;
  markDefeat(by);
  if (run) run.abort('defeated');
});

function markDefeat(by) {
  const s = ws();
  s.defeats++;
  s.defeatedUntil = worldTicks() + 24000 * 0.5;                        // silence for half a day
  wsDirty();
  if (by && by.typeId === 'minecraft:player') {
    const pf = profile(/** @type {any} */ (by)); pf.defeats++; markDirty(by);
    safe('msg', () => by.onScreenDisplay.setTitle('§7The Shaftbreaker falls', { subtitle: '§8the tunnels go quiet... for now', fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20 }));
  }
}

world.afterEvents.playerSpawn.subscribe((ev) => safe('spawn', () => {
  onPlayerSpawn(ev.player);
  if (ev.initialSpawn) safe('untag', () => ev.player.removeTag('sb_target'));
}));

world.afterEvents.playerLeave.subscribe((ev) => safe('leave', () => { dropPlayer(ev.playerId); forgetAudio(ev.playerId); }));

world.afterEvents.playerDimensionChange.subscribe((ev) => safe('dim', () => {
  const r = running();
  if (r && r.ctx.player.id === ev.player.id) r.abort('dimension');
}));

world.afterEvents.entitySpawn.subscribe((ev) => safe('eggAdopt', () => {
  const e = ev.entity;
  if (!valid(e) || e.typeId !== SB_ID) return;
  // decide next tick, after the director has registered its own spawns
  system.run(() => safe('eggAdopt2', () => {
    if (!valid(e)) return;
    const c = creature();
    if (c && c.e.id === e.id) return;
    if (e.getDynamicProperty('sb:scripted')) return;
    if (running()) { e.remove(); return; }                            // never two primaries
    adopt(e);                                                           // spawn egg / summon: newest wins
  }));
}));

world.afterEvents.explosion.subscribe((ev) => safe('explosion', () => {
  const c = creature();
  if (!c || !ev.dimension || ev.dimension.id !== c.dim.id) return;
  const r = running();
  if (r && r.tpl.family === 'hunt') { evidence(r.ctx.player, 'trap_reuse', 0.6, 'explosion during a hunt'); r.ctx.tel.notes.push('L51 explosion noted'); }
}));

world.afterEvents.itemUse.subscribe((ev) => safe('itemUse', () => {
  if (ev.itemStack.typeId === 'shaftbreaker:resonance_dial') system.run(() => { openDial(ev.source).catch((e) => reportError('dial', e)); });
}));

// ------------------------------------------------------------------ trophy (L83-L87)
function trophyTick() {
  const cfg = config();
  for (const p of world.getAllPlayers()) {
    const head = safe('head', () => p.getComponent('minecraft:equippable')?.getEquipment(/** @type {any} */ ('Head')), undefined);
    if (!head || head.typeId !== 'shaftbreaker:shaftbreaker_skull') continue;
    if (cfg.trophyVision && isUnderground(p)) safe('nv', () => p.addEffect('night_vision', 320, { amplifier: 0, showParticles: false }));
    const s = pstate(p);
    if (!s.nextHum || now() > s.nextHum) { s.nextHum = now() + sec(rand(35, 60)); playFor(p, 'shaftbreaker.trophy_hum', undefined, 0.25); }
    const pr = prefs(p);
    if ((pr.trophyFilter || cfg.trophyFilter) && !pr.reducedFlicker && (!s.nextPulse || now() > s.nextPulse)) {
      s.nextPulse = now() + sec(rand(45, 70));
      safe('pulse', () => p.camera.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 0.1, fadeOutTime: 0.8 }, fadeColor: { red: 0.12, green: 0.09, blue: 0.08 } }));
    }
  }
}

function debugTick() {
  if (config().debug === 'off') return;
  for (const p of world.getAllPlayers()) {
    if (!p.hasTag('sb_debug') || !isOperator(p)) continue;
    safe('dbg', () => p.onScreenDisplay.setActionBar(debugLine(p)));
  }
}

// ------------------------------------------------------------------ commands
const ACTIONS = ['help', 'status', 'menu', 'preset', 'set', 'debug', 'encounter', 'list', 'stop', 'telemetry', 'reset_me', 'reset_world', 'profile'];

function registerCommands(reg) {
  reg.registerEnum('shaftbreaker:action', ACTIONS);
  reg.registerCommand({
    name: 'shaftbreaker:sb',
    description: 'Shaftbreaker control: help | status | menu | preset <name> | set <key=value> | debug | encounter <id> | list | stop | telemetry | profile | reset_me | reset_world',
    permissionLevel: CommandPermissionLevel.GameDirectors,
    cheatsRequired: false,
    mandatoryParameters: [{ name: 'shaftbreaker:action', type: CustomCommandParamType.Enum }],
    optionalParameters: [{ name: 'value', type: CustomCommandParamType.String }],
  }, (origin, action, value) => {
    const src = origin.sourceEntity;
    system.run(() => safe('cmd', () => runAction(src, String(action), value ? String(value) : '')));
    return { status: CustomCommandStatus.Success };
  });
}

system.afterEvents.scriptEventReceive.subscribe((ev) => safe('scriptevent', () => {
  if (!ev.id.startsWith('shaftbreaker:')) return;
  const action = ev.id.slice('shaftbreaker:'.length);
  const src = ev.sourceEntity;
  if (src && src.typeId === 'minecraft:player' && !isOperator(src) && !['help', 'status', 'menu', 'reset_me', 'profile'].includes(action)) {
    /** @type {any} */ (src).sendMessage('§c[Shaftbreaker] operator only'); return;
  }
  runAction(src, action, ev.message.trim());
}));

function say(src, msg) {
  if (src && src.typeId === 'minecraft:player') safe('say', () => /** @type {any} */ (src).sendMessage(msg));
  else console.warn(msg.replace(/§./g, ''));
}

function runAction(src, action, value) {
  const player = src && src.typeId === 'minecraft:player' ? /** @type {any} */ (src) : null;
  switch (action) {
    case 'help':
      say(src, '§7/shaftbreaker:sb <status|menu|preset|set|debug|encounter|list|stop|telemetry|profile|reset_me|reset_world> [value]\n§7or /scriptevent shaftbreaker:<action> [value]');
      say(src, `§7presets: ${ENUMS.preset.join(', ')}  keys: ${Object.keys(DEFAULTS).join(', ')}`);
      return;
    case 'status': {
      const c = creature(); const s = ws();
      say(src, `§7[Shaftbreaker] enabled=${config().enabled} preset=${config().preset} danger=${s.danger.toFixed(0)} dens=${s.dens.filter((d) => !d.cleansed).length} hunts=${s.hunts} defeats=${s.defeats} creature=${c ? `${c.phase}/${c.mode}` : 'none'} encounter=${running() ? running().tpl.id : 'none'}`);
      if (player) say(src, debugLine(player));
      return;
    }
    case 'menu': if (player) openDial(player).catch((e) => reportError('dial', e)); return;
    case 'preset': say(src, applyPreset(value) ? `§7preset -> ${value}` : `§cunknown preset (${ENUMS.preset.join(', ')})`); return;
    case 'set': {
      const [k, raw] = value.split('=');
      if (!(k in DEFAULTS)) { say(src, `§cunknown key ${k}`); return; }
      const def = DEFAULTS[k];
      const v = typeof def === 'boolean' ? raw === 'true' || raw === '1' || raw === 'on' : typeof def === 'number' ? Number(raw) : raw;
      setConfig(k, v); say(src, `§7${k} = ${JSON.stringify(config()[k])}`); return;
    }
    case 'debug':
      if (!player) return;
      if (player.hasTag('sb_debug')) { player.removeTag('sb_debug'); say(src, '§7debug overlay off'); }
      else { player.addTag('sb_debug'); if (config().debug === 'off') setConfig('debug', 'basic'); say(src, '§7debug overlay on (tag sb_debug)'); }
      return;
    case 'encounter': if (player) say(src, `§7${forceEncounter(player, value || 'distant_watch')}`); return;
    case 'list': say(src, '§7' + TEMPLATES.map((t) => `${t.id}[${t.family}]`).join(' ')); return;
    case 'stop': stopEncounter(); stopAllMusic(); say(src, '§7stopped and despawned'); return;
    case 'telemetry':
      for (const r of recent(10)) say(src, `§8${r.id} §7${r.family} §f${r.outcome}§7 ${r.duration} phases=${r.phases.join('>')} §8trigger: ${r.trigger} | tell: ${r.telegraph} | counter: ${r.counterplay} | ${r.notes.join('; ')}`);
      return;
    case 'profile': if (player) { const pf = profile(player); say(src, `§7${JSON.stringify({ enc: pf.encounters, seen: pf.sightings, hunts: pf.hunts, esc: pf.huntsEscaped, fam: Math.round(pf.familiarity), routes: pf.routes.length, learn: pf.learnLog.slice(-3) })}`); } return;
    case 'reset_me': if (player) { resetProfile(player); say(src, '§7your memory profile was reset'); } return;
    case 'reset_world': wsReset(); despawnAll(true); say(src, '§7world state reset'); return;
    default: say(src, `§cunknown action ${action}`);
  }
}

export { mins, log };
