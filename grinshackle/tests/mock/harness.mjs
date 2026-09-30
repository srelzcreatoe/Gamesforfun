import { world, system, Player, __state, __tick, __reset, __reload, __signals, __log } from './minecraft-server.mjs';
export function createWorld(opts = {}) {
  __reset(opts);
  const dim = world.getDimension('overworld');
  const h = {
    world, system, state: __state,
    get log() { return __state.log; },
    tick(n = 1) { for (let i = 0; i < n; i++) __tick(); },
    addPlayer({ name, x, y, z, gameMode, view }) {
      const p = new Player(name, dim, { x, y, z }, gameMode || 'Survival'); __state.entities.set(p.id, p); __state.players.push(p);
      if (view) { const yaw = Math.atan2(-view.x, view.z) * 180 / Math.PI; p.setRotation({ x: 0, y: yaw }); }
      world.afterEvents.playerJoin.emit({ playerId: p.id, playerName: name });
      world.afterEvents.playerSpawn.emit({ player: p, initialSpawn: true });
      return p;
    },
    removePlayer(p) { __state.players = __state.players.filter((x) => x !== p); __state.entities.delete(p.id); p.__removed = true; },
    spawnEntity(typeId, loc) { return dim.spawnEntity(typeId, loc); },
    setBlock(x, y, z, typeId) { __state.overrides.set(x + ',' + y + ',' + z, typeId); },
    fire(name, data) {
      const s = __signals['world.' + name] || __signals['system.' + name] || __signals['world.before.' + name];
      if (!s) throw new Error('unknown signal ' + name); s.emit(data);
    },
    queueFormResponse(r) { __state.formQueue.push(r); },
    unloadEntity(e) { e.__unloaded = true; },
    reloadEntity(e) { e.__unloaded = false; world.afterEvents.entityLoad.emit({ entity: e }); },
    reload() { __reload(); },
  };
  return h;
}
