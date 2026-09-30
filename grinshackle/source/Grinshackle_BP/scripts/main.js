// Entry point: event wiring and the tick loop. Everything else lives in the modules (see ARCHITECTURE.md in the repo docs).
import { world, system } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, logError, log } from './util.js';
import * as timers from './timers.js';
import * as config from './config.js';
import * as gates from './gates.js';
import * as reservation from './reservation.js';
import * as perception from './perception.js';
import * as director from './director.js';
import * as preview from './preview.js';
import * as omens from './omens.js';
import * as items from './items.js';
import * as commands from './commands.js';
import * as audio from './audio.js';
import * as memory from './memory.js';

const T = (s) => Math.round(s * 20);

function boot() {
  if (S.loaded) return;
  S.loaded = true;
  config.load();
  reservation.migrateV1();
  reservation.load();
  director.loadHistory();
  S.owner = safe(() => world.getDynamicProperty(IDS.PROP_OWNER), undefined);
  S.naturalGraceUntil = S.tick + T(config.get('graceSeconds'));
  S.nextNaturalCheck = S.tick;
  perception.clearTargetTags();
  // Adopt creatures that are already loaded (reload during an encounter restarts it through emergence).
  for (const id of ['overworld', 'nether', 'the_end']) {
    for (const e of safe(() => world.getDimension(id).getEntities({ type: IDS.ENTITY }), [])) adoptEntity(e);
    for (const e of safe(() => world.getDimension(id).getEntities({ type: IDS.LEGACY_ENTITY }), [])) safe(() => e.remove());
    for (const w of safe(() => world.getDimension(id).getEntities({ type: IDS.WAYPOINT }), [])) safe(() => w.remove());
  }
  log('info', `loaded v4.0.0 (master ${config.get('master') ? 'on' : 'off'}, natural ${config.get('naturalSpawning') ? 'on' : 'off'})`);
}

/** A creature spawned or loaded: decide whether it is the reserved one, a duplicate, stale, or a preview. */
function adoptEntity(e) {
  if (!isValid(e) || e.typeId !== IDS.ENTITY) return;
  const verdict = reservation.adopt(e, gates.masterEnabled());
  if (verdict !== 'active') {
    if (verdict === 'duplicate_removed') { const p = perception.chooseTarget(e, 16) || safe(() => world.getAllPlayers()[0], undefined); if (p) safe(() => p.onScreenDisplay.setActionBar('§7[only one Grinshackle can exist — the extra one dissolved]')); }
    log('info', 'adopt: ' + verdict);
    return;
  }
  const res = reservation.current();
  const mode = (res && res.entityId === e.id ? res.mode : safe(() => e.getDynamicProperty(IDS.ENT_MODE), undefined)) || 'egg';
  if (mode === 'preview') { if (!S.preview) safe(() => e.remove()); return; }
  if (S.active && isValid(S.active) && S.active.id === e.id && S.record) return;
  const player = perception.chooseTarget(e, 48);
  director.beginEncounter(e, mode === 'natural' || mode === 'test' ? mode : 'egg', player);
}

// ------------------------------------------------------------------ events
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== IDS.SCRIPT_EVENT) return;
  try { boot(); commands.handle(ev.sourceEntity, ev.message); } catch (e) { logError(e); }
});
world.afterEvents.entitySpawn.subscribe((ev) => { if (ev.entity.typeId === IDS.ENTITY) system.run(() => { try { boot(); adoptEntity(ev.entity); } catch (e) { logError(e); } }); });
world.afterEvents.entityLoad.subscribe((ev) => { if (ev.entity.typeId === IDS.ENTITY || ev.entity.typeId === IDS.LEGACY_ENTITY) system.run(() => { try { boot(); if (ev.entity.typeId === IDS.LEGACY_ENTITY) safe(() => ev.entity.remove()); else adoptEntity(ev.entity); } catch (e) { logError(e); } }); });
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    if (ev.deadEntity.typeId === IDS.ENTITY) director.onDied(ev);
    else if (ev.deadEntity.typeId === 'minecraft:player') { safe(() => ev.deadEntity.setDynamicProperty(IDS.PLAYER_LAST_DEATH, S.tick)); director.onTargetLost(ev.deadEntity.id); audio.stopFor(ev.deadEntity); }
  } catch (e) { logError(e); }
});
world.afterEvents.entityHurt.subscribe((ev) => { try { if (ev.hurtEntity.typeId === IDS.ENTITY) director.onHurt(ev); } catch (e) { logError(e); } });
world.afterEvents.playerSpawn.subscribe((ev) => { try { boot(); items.onPlayerSpawn(ev); if (!ev.initialSpawn) safe(() => ev.player.setDynamicProperty(IDS.PLAYER_LAST_SPAWN, S.tick)); } catch (e) { logError(e); } });
world.afterEvents.playerLeave.subscribe((ev) => { try { director.onTargetLost(ev.playerId); S.music.delete(ev.playerId); S.samples.delete(ev.playerId); memory.flush(ev.playerId); } catch (e) { logError(e); } });
world.afterEvents.playerGameModeChange.subscribe((ev) => { try { if (!gates.playerEligible(ev.player)) { director.onTargetLost(ev.player.id); audio.stopFor(ev.player); } } catch (e) { logError(e); } });
world.afterEvents.playerDimensionChange.subscribe((ev) => { try { director.onTargetLost(ev.player.id); audio.stopFor(ev.player); } catch (e) { logError(e); } });
world.afterEvents.playerBreakBlock.subscribe((ev) => { try { perception.recordNoise('break', ev.block.location, ev.player.id, 2.0); omens.onBlockBreak(ev); } catch (e) { logError(e); } });
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try {
    perception.recordNoise('place', ev.block.location, ev.player.id, 1.2);
    if (/:(torch|wall_torch|lantern|soul_lantern|soul_torch|glowstone|sea_lantern|shroomlight|lit_pumpkin|end_rod|campfire|froglight)/.test(ev.block.typeId)) memory.observe(ev.player.id, 'lights', 1);
  } catch (e) { logError(e); }
});
world.afterEvents.playerInteractWithBlock.subscribe((ev) => { try { if (ev.block && /:bell$/.test(ev.block.typeId)) { perception.recordNoise('bell', ev.block.location, ev.player.id, 6.0); omens.onLoudEvent('bell', ev.block.location, ev.player.id); } } catch (e) { logError(e); } });
world.afterEvents.pressurePlatePush.subscribe((ev) => { try { const src = ev.source; perception.recordNoise('plate', ev.block.location, src && src.typeId === 'minecraft:player' ? src.id : undefined, 2.5); omens.onLoudEvent('plate', ev.block.location, src ? src.id : undefined); } catch (e) { logError(e); } });
world.afterEvents.leverAction.subscribe((ev) => { try { perception.recordNoise('lever', ev.block.location, ev.player ? ev.player.id : undefined, 1.5); omens.onLoudEvent('lever', ev.block.location, ev.player ? ev.player.id : undefined); } catch (e) { logError(e); } });
world.afterEvents.buttonPush.subscribe((ev) => { try { const src = ev.source; perception.recordNoise('button', ev.block.location, src ? src.id : undefined, 1.5); omens.onLoudEvent('button', ev.block.location, src ? src.id : undefined); } catch (e) { logError(e); } });
world.afterEvents.itemUse.subscribe((ev) => { try { boot(); items.onItemUse(ev); } catch (e) { logError(e); } });

// ------------------------------------------------------------------ tick loop
system.runInterval(() => {
  S.tick++;
  try {
    if (!S.loaded) boot();
    timers.pump(gates.masterEnabled());
    if (!gates.masterEnabled()) {
      if (S.record || S.active || S.preview) { director.masterOff(); preview.stop(); }
      return;
    }
    if (S.active && !isValid(S.active)) director.onUnloaded();
    director.tick();
    preview.tick();
    if (S.tick % 100 === 0) {
      director.naturalSpawnTick();
      reservation.retireIfLost(config.get('lostReservationMinutes'));
    }
    if (S.tick % 600 === 0) memory.flush();
  } catch (e) { logError(e); }
}, 1);
