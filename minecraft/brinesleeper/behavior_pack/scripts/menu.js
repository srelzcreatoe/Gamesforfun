// The settings wheel (brine:config_wheel) and the commands: /brine:settings, /brine:wheel, /brine:encounter, /brine:status.
import { world, system, ItemStack, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { config, setConfig, PRESETS, PRESET_KEYS, THREATS } from './config.js';
import { CREATURE, EVENT_NAMES, creatures, forceEvent, statusText } from './main.js';

const WHEEL = 'brine:config_wheel';
const isOp = (p) => { try { return p.commandPermissionLevel >= CommandPermissionLevel.GameDirectors; } catch (e) { return false; } };
const onOff = (b) => (b ? '§aon§r' : '§8off§r');

function giveWheel(player) {
  try { player.getComponent('minecraft:inventory')?.container?.addItem(new ItemStack(WHEEL, 1)); } catch (e) { /* full or gone */ }
}

export function openMenu(player) {
  const p = PRESETS[config.preset];
  const body = `${config.enabled ? '§aAwake§r' : '§7Asleep§r'}  ·  ${p.label}  ·  ${THREATS[config.threat].label}\n` +
    `Heartbeat ${onOff(config.heartbeat)}  Music ${onOff(config.music)}  Screen effects ${onOff(config.screen)}\n` +
    `Whispers ${onOff(config.whispers)}  Lures ${onOff(config.lures)}  Takes lights ${onOff(config.lights)}`;
  if (!isOp(player)) {
    player.sendMessage('§7Only operators can change the Brinesleeper settings.');
    return;
  }
  new ActionFormData().title('§lThe Brinesleeper').body(body)
    .button('Presets & pacing').button('The creature').button('Atmosphere').button('The caves').button('Test an encounter').button('Close')
    .show(player).then((r) => {
      if (r.canceled || r.selection === undefined) return;
      [pacing, creature, atmosphere, caves, test][r.selection]?.(player);
    }).catch(() => { /* closed */ });
}

function pacing(player) {
  new ModalFormData().title('Presets & pacing')
    .toggle('Awake (the director and the creature\'s mind run)', { defaultValue: config.enabled })
    .dropdown('Preset', PRESET_KEYS.map((k) => PRESETS[k].label), { defaultValueIndex: Math.max(0, PRESET_KEYS.indexOf(config.preset)) })
    .slider('Encounter frequency (%)', 50, 200, { defaultValue: config.frequency, valueStep: 10 })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      const [enabled, preset, frequency] = r.formValues;
      setConfig({ enabled: !!enabled, preset: PRESET_KEYS[Number(preset)] ?? 'balanced', frequency: Number(frequency) });
      openMenu(player);
    }).catch(() => { /* closed */ });
}

function creature(player) {
  const keys = Object.keys(THREATS).map(Number);
  new ModalFormData().title('The creature')
    .dropdown('Threat', keys.map((k) => `${THREATS[k].label}`), { defaultValueIndex: Math.max(0, keys.indexOf(config.threat)) })
    .toggle('Drowning grasp (it drags swimmers under)', { defaultValue: config.grasp })
    .toggle('It takes your lights (torches fall, candles go out)', { defaultValue: config.lights })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      const [th, grasp, lights] = r.formValues;
      setConfig({ threat: keys[Number(th)] ?? 2, grasp: !!grasp, lights: !!lights });
      for (const c of creatures()) { try { c.triggerEvent(`brine:threat_${config.threat}`); } catch (e) { /* ok */ } }
      openMenu(player);
    }).catch(() => { /* closed */ });
}

function atmosphere(player) {
  new ModalFormData().title('Atmosphere')
    .toggle('Heartbeat when it is near', { defaultValue: config.heartbeat })
    .toggle('Chase music and stings', { defaultValue: config.music })
    .toggle('Screen effects (shake, darkness, black-out when grabbed)', { defaultValue: config.screen })
    .toggle('Whispers', { defaultValue: config.whispers })
    .toggle('Lures (sounds that should not be down here)', { defaultValue: config.lures })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      const [heartbeat, music, screen, whispers, lures] = r.formValues;
      setConfig({ heartbeat: !!heartbeat, music: !!music, screen: !!screen, whispers: !!whispers, lures: !!lures });
      openMenu(player);
    }).catch(() => { /* closed */ });
}

function caves(player) {
  new ModalFormData().title('The caves')
    .toggle('No other hostile mobs in the Stillwater Caves', { defaultValue: config.blockHostiles })
    .toggle('Repair floating vines and plants, seal leaking lake edges', { defaultValue: config.repair })
    .toggle('Debug messages (operators)', { defaultValue: config.debug })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      const [blockHostiles, repair, dbg] = r.formValues;
      setConfig({ blockHostiles: !!blockHostiles, repair: !!repair, debug: !!dbg });
      openMenu(player);
    }).catch(() => { /* closed */ });
}

function test(player) {
  const names = [...EVENT_NAMES, 'summon_here'];
  new ModalFormData().title('Test an encounter')
    .dropdown('Stage now, for you', names.map((n) => n.replace(/_/g, ' ')), { defaultValueIndex: 0 })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      const name = names[Number(r.formValues[0])];
      if (name === 'summon_here') {
        const v = player.getViewDirection();
        try { player.dimension.spawnEntity(CREATURE, { x: player.location.x + v.x * 12, y: player.location.y, z: player.location.z + v.z * 12 }); }
        catch (e) { player.sendMessage('§7No room there.'); }
      } else if (!forceEvent(player, name)) player.sendMessage('§7Nothing to stage that here.');
    }).catch(() => { /* closed */ });
}

// ------------------------------------------------------------------ the wheel, commands and script events
world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === WHEEL) openMenu(source);
});
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || !isOp(player) || player.getDynamicProperty('brine:wheel')) return;
  player.setDynamicProperty('brine:wheel', true);
  system.runTimeout(() => {
    giveWheel(player);
    player.sendMessage('§8The Brinesleeper: use the §7Brinesleeper Settings§8 wheel to change how it hunts.');
  }, 40);
});

system.beforeEvents.startup.subscribe(({ customCommandRegistry: reg }) => {
  reg.registerEnum('brine:encounter_name', EVENT_NAMES);
  const asPlayer = (origin) => {
    const p = origin.sourceEntity;
    return p && p.typeId === 'minecraft:player' ? /** @type {import('@minecraft/server').Player} */ (p) : undefined;
  };
  reg.registerCommand({ name: 'brine:settings', description: 'Open the Brinesleeper settings.',
    permissionLevel: CommandPermissionLevel.GameDirectors }, (origin) => {
    const p = asPlayer(origin);
    if (!p) return { status: CustomCommandStatus.Failure, message: 'Run this as a player.' };
    system.run(() => openMenu(p));
    return { status: CustomCommandStatus.Success };
  });
  reg.registerCommand({ name: 'brine:wheel', description: 'Get the Brinesleeper Settings wheel.',
    permissionLevel: CommandPermissionLevel.GameDirectors }, (origin) => {
    const p = asPlayer(origin);
    if (!p) return { status: CustomCommandStatus.Failure, message: 'Run this as a player.' };
    system.run(() => giveWheel(p));
    return { status: CustomCommandStatus.Success };
  });
  reg.registerCommand({ name: 'brine:encounter', description: 'Testing: stage one Brinesleeper encounter for yourself now.',
    permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true,
    mandatoryParameters: [{ name: 'brine:encounter_name', type: CustomCommandParamType.Enum }] }, (origin, name) => {
    const p = asPlayer(origin);
    if (!p) return { status: CustomCommandStatus.Failure, message: 'Run this as a player.' };
    system.run(() => forceEvent(p, String(name)));
    return { status: CustomCommandStatus.Success, message: `Staging ${name}.` };
  });
  reg.registerCommand({ name: 'brine:status', description: 'Testing: show the hidden director state for yourself.',
    permissionLevel: CommandPermissionLevel.GameDirectors, cheatsRequired: true }, (origin) => {
    const p = asPlayer(origin);
    if (!p) return { status: CustomCommandStatus.Failure };
    return { status: CustomCommandStatus.Success, message: statusText(p) };
  });
});

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (!sourceEntity || sourceEntity.typeId !== 'minecraft:player') return;
  const p = /** @type {import('@minecraft/server').Player} */ (sourceEntity);
  if (id === 'brine:settings') openMenu(p);
  else if (id === 'brine:wheel') giveWheel(p);
  else if (id === 'brine:encounter') forceEvent(p, message.trim());
});
