// 22 ready-made horror dwellers. The first two follow the user's reference
// drawings; the rest are original designs with different bodies, faces,
// stalking styles, habitats and appearance timings.
import { baseEntity } from './model.js';
import { makeModel, DWELLER_BODIES } from './geo.js';
import { defaultAnims } from './anim.js';
import { defaultHorror, ARCHETYPES, dwellerSpawn } from './horror.js';

const pool = (item, min, max) => ({
  rolls: 1,
  entries: [{ type: 'item', name: item, weight: 1, functions: [{ function: 'set_count', count: { min, max } }, { function: 'looting_enchant', count: { min: 0, max: 1 } }] }],
});
const snd = (map, pitch) => ({
  enabled: true, volume: 1, pitch, interval: 9,
  events: Object.fromEntries(Object.entries(map).map(([k, s]) => [k, { sound: s, volume: k === 'step' ? 0.3 : 1, pitch: 1 }])),
});

export const DWELLER_PRESETS = [
  {
    id: 'night_grinner', label: 'Night Grinner', icon: '😁', signature: true,
    blurb: 'Creature of the night: glowing eyes, a bleeding grin and long dark arms. Stalks you anywhere after dark.',
    body: 'grinner', spec: { neckW: 5 },
    colors: { body: '#121014', head: '#121014', arms: '#121014', hands: '#e8b06a', legs: '#121014' },
    patterns: { body: ['fade', '#3a0a0c'], arms: ['fade', '#2a0809'], legs: ['fade', '#200608'] },
    paint: { eyeStyle: 'rect', eyeColor: '#ffb648', mouth: 'bigGrin', faceColor: '#5c0f12', dripColor: '#8a1014', toothColor: '#ecd27c', outlineColor: '#050405', noise: 0.06 },
    style: 'stalker', type: 'both', time: 'night', appear: { firstAfter: 4, every: [6, 12], chance: 70 },
    stats: [50, 9, 0.33], sounds: [{ ambient: 'mob.warden.idle', hurt: 'mob.endermen.hit', death: 'mob.ghast.death', step: 'mob.warden.step' }, [0.5, 0.7]],
    loot: [pool('minecraft:bone', 1, 3), pool('minecraft:redstone', 0, 2)],
    scares: { screamSound: 'mob.warden.roar', notice: 'Something is grinning at you...', huntMsg: 'RUN.' },
  },
  {
    id: 'hollow_grinner', label: 'Hollow Grinner', icon: '🦴', signature: true,
    blurb: 'Starved and clawed, with sunken eyes and too many teeth. Hunches through deep caves on arms that drag the floor.',
    body: 'lurker', spec: {},
    colors: { body: '#8a7b30', head: '#8a7b30', arms: '#857629', hands: '#a89650', legs: '#7d6f28' },
    patterns: { body: ['ribs', '#3d3510'], head: ['veins', '#4a4114'], arms: ['veins', '#4a4114'], legs: ['veins', '#4a4114'] },
    paint: { eyeStyle: 'sunken', eyeColor: '#ffffff', mouth: 'bigGrin', toothColor: '#efe6c4', dripColor: '#4a3c10', outlineColor: '#141206', noise: 0.08 },
    style: 'stalker', type: 'underground', time: 'always', appear: { firstAfter: 3, every: [5, 10], chance: 75 },
    stats: [45, 8, 0.34], sounds: [{ ambient: 'mob.warden.listening', hurt: 'mob.warden.hurt', death: 'mob.warden.death', step: 'mob.warden.step' }, [0.6, 0.8]],
    loot: [pool('minecraft:bone', 2, 4), pool('minecraft:rotten_flesh', 0, 2)],
    scares: { screamSound: 'mob.warden.roar', notice: 'You hear scraping in the dark.', huntMsg: 'IT SEES YOU.' },
    anims: { hunch: 1.5 },
  },
  {
    id: 'pale_watcher', label: 'Pale Watcher', icon: '👁', blurb: 'A thin white figure far across the field. It only watches… stare too long and it is gone.',
    body: 'lurker', spec: { hands: 'block', headH: 10 },
    colors: { body: '#d8d2c6', head: '#e4dfd4', arms: '#d0cabd', hands: '#d0cabd', legs: '#c8c1b4' },
    patterns: { body: ['cracks', '#8a8274'], head: ['none'] },
    paint: { eyeStyle: 'hollow', eyeColor: '#f2eee4', mouth: 'none', noise: 0.05 },
    style: 'watcher', type: 'surface', time: 'night', appear: { firstAfter: 6, every: [8, 16], chance: 60, distance: 'far' },
    stats: [30, 6, 0.3], sounds: [{ ambient: 'ambient.cave', hurt: 'mob.endermen.hit', death: 'mob.endermen.death' }, [0.6, 0.8]],
    loot: [pool('minecraft:bone', 1, 2)], scares: { notice: 'You are being watched.' },
  },
  {
    id: 'still_one', label: 'The Still One', icon: '🗿', blurb: 'A cracked stone figure. It cannot move while you look at it. Don\'t blink.',
    body: 'lurker', spec: { hands: 'block', headH: 9, headW: 7, legW: 3, armW: 3, armLen: 26 },
    colors: { body: '#7c7f84', head: '#8a8d92', arms: '#74777c', hands: '#74777c', legs: '#6b6e73' },
    patterns: { body: ['cracks', '#3e4044'], head: ['cracks', '#3e4044'], arms: ['cracks', '#3e4044'] },
    paint: { eyeStyle: 'hollow', eyeColor: '#ff3b3b', mouth: 'none', noise: 0.14 },
    style: 'statue', type: 'both', time: 'always', appear: { firstAfter: 5, every: [7, 14], chance: 60 },
    stats: [60, 10, 0.35], sounds: [{ ambient: 'mob.creaking.ambient', hurt: 'mob.creaking.sway', death: 'mob.creaking.death', step: 'mob.creaking.step' }, [0.6, 0.8]],
    loot: [pool('minecraft:cobblestone', 2, 5)], anims: { twitch: 0, idle: 0 },
  },
  {
    id: 'ceiling_crawler', label: 'Ceiling Crawler', icon: '🕷', blurb: 'Clings to cave walls and ceilings and lunges the moment you look up.',
    body: 'spider', spec: {},
    colors: { body: '#2e292d', head: '#3a3438', legs: '#221e21' },
    patterns: { body: ['grime', '#0f0d10'] },
    paint: { eyeStyle: 'glow', eyeColor: '#ff2a2a', mouth: 'grin', noise: 0.1 },
    style: 'crawler', type: 'underground', time: 'always', appear: { firstAfter: 4, every: [6, 11], chance: 65, distance: 'near' },
    stats: [24, 6, 0.38], sounds: [{ ambient: 'mob.spider.say', hurt: 'mob.spider.say', death: 'mob.spider.death', step: 'mob.spider.step' }, [0.6, 0.8]],
    loot: [pool('minecraft:string', 1, 3), pool('minecraft:spider_eye', 0, 1)],
  },
  {
    id: 'hollow_shade', label: 'Hollow Shade', icon: '🌫', blurb: 'A drifting hooded shadow. Fog rolls in, the torches feel dimmer, and it vanishes when you look.',
    body: 'wraith', spec: {},
    colors: { body: '#17151c', head: '#1d1a24', arms: '#1b1822', hands: '#2a2533' },
    patterns: { body: ['gradient', '#3b3550'] },
    paint: { eyeStyle: 'glow', eyeColor: '#b48cff', mouth: 'none', noise: 0.08 },
    style: 'shade', type: 'both', time: 'night', appear: { firstAfter: 5, every: [8, 15], chance: 55 },
    stats: [30, 7, 0.28], sounds: [{ ambient: 'mob.vex.ambient', hurt: 'mob.vex.hurt', death: 'mob.vex.death' }, [0.4, 0.6]],
    loot: [pool('minecraft:phantom_membrane', 0, 2)], scares: { fogColor: '#0b0814' },
  },
  {
    id: 'mimic', label: 'Mimic', icon: '🎭', blurb: 'Looks and sounds like a lost villager at night, until you walk up to it.',
    body: 'grinner', spec: { legLen: 12, legW: 4, footL: 0, hipW: 8, torsoW: 8, torsoH: 12, torsoD: 4, neck: 0, headW: 8, headH: 9, headD: 8, armLen: 12, armW: 4, hands: 'none', hunch: 0 },
    colors: { body: '#7a5a3a', head: '#d9a57c', arms: '#7a5a3a', legs: '#5e4630' },
    patterns: {}, paint: { eyeStyle: 'normal' },
    style: 'mimic', type: 'surface', time: 'night', appear: { firstAfter: 7, every: [10, 18], chance: 60, distance: 'near' },
    stats: [30, 8, 0.3], sounds: [{ ambient: 'mob.villager.idle', hurt: 'mob.villager.hit', death: 'mob.warden.death' }, [0.8, 1.0]],
    loot: [pool('minecraft:emerald', 0, 2)], anims: { twitch: 0.35, hunch: 0 },
  },
  {
    id: 'screamer', label: 'Screamer', icon: '😱', blurb: 'A pale face in the distance at night. Meet its gaze and it shrieks and sprints.',
    body: 'lurker', spec: { hands: 'block' },
    colors: { body: '#1c1c22', head: '#e9e4da', arms: '#1c1c22', hands: '#e9e4da', legs: '#16161b' },
    patterns: { body: ['grime', '#000000'] },
    paint: { eyeStyle: 'hollow', eyeColor: '#ffffff', mouth: 'gape', noise: 0.07 },
    style: 'screamer', type: 'surface', time: 'night', appear: { firstAfter: 6, every: [9, 16], chance: 55, distance: 'far' },
    stats: [30, 8, 0.36], sounds: [{ ambient: 'mob.ghast.moan', hurt: 'mob.ghast.scream', death: 'mob.ghast.death' }, [0.5, 0.7]],
    loot: [pool('minecraft:bone', 1, 2)],
  },
  {
    id: 'antlered_stranger', label: 'Antlered Stranger', icon: '🦌', blurb: 'A skull-faced figure with antlers that peeks from the treeline and ducks away.',
    body: 'lurker', spec: { antlers: true, hands: 'claws', clawLen: 4 },
    colors: { body: '#2a2622', head: '#e6dfcf', arms: '#2a2622', hands: '#3a342e', legs: '#221f1c', extra: '#d8cfba' },
    patterns: { body: ['grime', '#121010'] },
    paint: { eyeStyle: 'hollow', eyeColor: '#d9d2c2', mouth: 'grin', toothColor: '#e6dfcf', noise: 0.07 },
    style: 'peeker', type: 'surface', time: 'night', appear: { firstAfter: 5, every: [8, 14], chance: 65, distance: 'far' },
    stats: [40, 9, 0.34], sounds: [{ ambient: 'mob.goat.ambient.screamer', hurt: 'mob.goat.hurt.screamer', death: 'mob.goat.death.screamer' }, [0.5, 0.7]],
    loot: [pool('minecraft:bone', 2, 3), pool('minecraft:leather', 0, 2)],
  },
  {
    id: 'tall_gentleman', label: 'Tall Gentleman', icon: '🎩', blurb: 'Impossibly tall, in a black suit and top hat, with no face. Every time you look, it is somewhere closer.',
    body: 'lurker', spec: { legLen: 28, torsoH: 15, armLen: 30, armW: 2, hands: 'block', handSize: 2, hat: true, headH: 9, headW: 7 },
    colors: { body: '#101012', head: '#f0ece4', arms: '#101012', hands: '#e8e4dc', legs: '#0c0c0e', extra: '#0a0a0c' },
    patterns: {}, paint: { eyeStyle: 'none', mouth: 'none', noise: 0.03 },
    style: 'shadow', type: 'surface', time: 'night', appear: { firstAfter: 6, every: [9, 15], chance: 60 },
    stats: [40, 9, 0.32], sounds: [{ ambient: 'mob.endermen.idle', hurt: 'mob.endermen.hit', death: 'mob.endermen.death' }, [0.5, 0.6]],
    loot: [pool('minecraft:ender_pearl', 0, 1)],
  },
  {
    id: 'many_eyes', label: 'Many Eyes', icon: '🫥', blurb: 'Its head is covered in glowing eyes. Deep underground, they all open at once.',
    body: 'lurker', spec: { headW: 9, headH: 9, headD: 9, hands: 'claws' },
    colors: { body: '#2b1f33', head: '#3a2944', arms: '#2b1f33', hands: '#1f1626', legs: '#21182a' },
    patterns: { body: ['veins', '#140c18'] },
    paint: { eyeStyle: 'many', eyeColor: '#ffe066', mouth: 'gape', noise: 0.08 },
    style: 'stalker', type: 'underground', time: 'always', appear: { firstAfter: 5, every: [7, 13], chance: 65 },
    stats: [40, 8, 0.33], sounds: [{ ambient: 'mob.warden.clicking', hurt: 'mob.warden.hurt', death: 'mob.warden.death', step: 'mob.warden.step' }, [0.7, 0.9]],
    loot: [pool('minecraft:spider_eye', 1, 3)],
  },
  {
    id: 'the_smiler', label: 'The Smiler', icon: '😀', blurb: 'Pitch black except for a huge white smile. It peeks around corners, then it\'s gone.',
    body: 'grinner', spec: { hands: 'none', armW: 3 },
    colors: { body: '#0b0b0d', head: '#0b0b0d', arms: '#0b0b0d', legs: '#0b0b0d' },
    patterns: {}, paint: { eyeStyle: 'none', mouth: 'bigGrin', toothColor: '#f5f5f5', dripColor: '#1a1a1a', noise: 0.03 },
    style: 'peeker', type: 'both', time: 'night', appear: { firstAfter: 4, every: [7, 12], chance: 65 },
    stats: [35, 8, 0.34], sounds: [{ ambient: 'mob.ghast.affectionate_scream', hurt: 'mob.endermen.hit', death: 'mob.ghast.death' }, [0.4, 0.6]],
    loot: [pool('minecraft:bone', 1, 2)],
  },
  {
    id: 'long_neck', label: 'Long Neck', icon: '🦒', blurb: 'Its head rises over walls and treetops on a neck far too long, then sinks out of sight.',
    body: 'longneck', spec: {},
    colors: { body: '#9aa38f', head: '#a9b29e', arms: '#8e9783', hands: '#8e9783', legs: '#838c79' },
    patterns: { body: ['veins', '#5a6250'] },
    paint: { eyeStyle: 'sunken', eyeColor: '#ffffff', mouth: 'line', noise: 0.07 },
    style: 'peeker', type: 'surface', time: 'night', appear: { firstAfter: 5, every: [9, 15], chance: 60, distance: 'far' },
    stats: [35, 7, 0.32], sounds: [{ ambient: 'mob.creaking.twitch', hurt: 'mob.creaking.sway', death: 'mob.creaking.death' }, [0.6, 0.8]],
    loot: [pool('minecraft:bone', 1, 3)],
  },
  {
    id: 'burrower', label: 'Burrower', icon: '🦡', blurb: 'A low, spiked digger with burning eyes. Notices you and charges straight through the tunnel.',
    body: 'hound', spec: { bodyLen: 16, torsoW: 10, torsoH: 8, legLen: 8, legW: 3, neck: 1, headW: 8, headH: 6, headD: 7, spikes: true, tail: 0 },
    colors: { body: '#4a3524', head: '#5a4130', legs: '#3a2a1c' },
    patterns: { body: ['grime', '#20160e'] },
    paint: { eyeStyle: 'glow', eyeColor: '#ff8a1a', mouth: 'grin', noise: 0.1 },
    style: 'hunter', type: 'underground', time: 'always', appear: { firstAfter: 6, every: [8, 14], chance: 55, distance: 'near' },
    stats: [45, 9, 0.3], sounds: [{ ambient: 'mob.warden.dig', hurt: 'mob.warden.hurt', death: 'mob.warden.death', step: 'mob.warden.step' }, [0.8, 1.0]],
    loot: [pool('minecraft:flint', 1, 3), pool('minecraft:iron_nugget', 0, 4)],
  },
  {
    id: 'deep_hound', label: 'Deep Hound', icon: '🐕', blurb: 'An eyeless, ribbed hound on stilt legs that follows your scent through the caves.',
    body: 'hound', spec: { legLen: 16 },
    colors: { body: '#3c3a36', head: '#4a4844', legs: '#2c2a27' },
    patterns: { body: ['ribs', '#151412'] },
    paint: { eyeStyle: 'none', mouth: 'bigGrin', toothColor: '#e8e2d0', noise: 0.08 },
    style: 'stalker', type: 'underground', time: 'always', appear: { firstAfter: 4, every: [6, 12], chance: 65 },
    stats: [30, 7, 0.38], sounds: [{ ambient: 'mob.wolf.growl', hurt: 'mob.wolf.hurt', death: 'mob.wolf.death', step: 'mob.wolf.step' }, [0.5, 0.7]],
    loot: [pool('minecraft:bone', 2, 4)],
  },
  {
    id: 'scarecrow', label: 'Scarecrow', icon: '🌾', blurb: 'A straw figure with a sack for a head. Only moves when you turn your back.',
    body: 'lurker', spec: { hands: 'block', handSize: 3, headW: 7, headH: 8, headD: 7, armW: 2, hat: true },
    colors: { body: '#c9a24a', head: '#b89a6a', arms: '#c9a24a', hands: '#e2c46a', legs: '#6b5a3a', extra: '#4a3a24' },
    patterns: { body: ['stripes', '#8a6a2a'], arms: ['stripes', '#8a6a2a'] },
    paint: { eyeStyle: 'button', eyeColor: '#2a2a2a', mouth: 'stitched', noise: 0.12 },
    style: 'statue', type: 'surface', time: 'night', appear: { firstAfter: 5, every: [8, 14], chance: 60 },
    stats: [30, 7, 0.36], sounds: [{ ambient: 'mob.creaking.sway', hurt: 'mob.creaking.attack', death: 'mob.creaking.death' }, [0.7, 0.9]],
    loot: [pool('minecraft:wheat', 2, 5), pool('minecraft:carved_pumpkin', 0, 1)], anims: { twitch: 0.3, idle: 0 },
  },
  {
    id: 'mannequin', label: 'Mannequin', icon: '🧍', blurb: 'Smooth, faceless and beige. Every time you look back, it is standing closer.',
    body: 'grinner', spec: { legLen: 22, legW: 3, footL: 1, torsoW: 9, torsoH: 13, headW: 7, headH: 9, headD: 7, armLen: 24, armW: 3, hands: 'block', handSize: 3, hunch: 0 },
    colors: { body: '#d9c7ad', head: '#e0cfb6', arms: '#d4c2a8', hands: '#d4c2a8', legs: '#cdbba1' },
    patterns: {}, paint: { eyeStyle: 'none', mouth: 'none', noise: 0.02, outlineColor: '#b8a68c' },
    style: 'statue', type: 'both', time: 'always', appear: { firstAfter: 6, every: [8, 15], chance: 60 },
    stats: [40, 8, 0.36], sounds: [{ ambient: 'mob.armor_stand.hit', hurt: 'mob.armor_stand.hit', death: 'mob.armor_stand.break' }, [0.8, 1.0]],
    loot: [pool('minecraft:string', 1, 2)], anims: { twitch: 0, idle: 0, hunch: 0 },
  },
  {
    id: 'drowned_weeper', label: 'Drowned Weeper', icon: '💧', blurb: 'Pale and waterlogged, it weeps black water from bright eyes as it follows you through flooded caves.',
    body: 'lurker', spec: { hands: 'claws', clawLen: 4 },
    colors: { body: '#5f8a87', head: '#6f9a97', arms: '#5a827f', hands: '#4c6f6c', legs: '#527a77' },
    patterns: { body: ['veins', '#2c4a48'], head: ['veins', '#2c4a48'] },
    paint: { eyeStyle: 'rect', eyeColor: '#e8fbff', mouth: 'gape', dripColor: '#12302f', noise: 0.08 },
    style: 'stalker', type: 'underground', time: 'always', appear: { firstAfter: 5, every: [7, 13], chance: 60 },
    stats: [35, 7, 0.32], sounds: [{ ambient: 'mob.drowned.say_water', hurt: 'mob.drowned.hurt_water', death: 'mob.drowned.death_water' }, [0.6, 0.8]],
    loot: [pool('minecraft:prismarine_shard', 0, 2), pool('minecraft:rotten_flesh', 1, 2)],
  },
  {
    id: 'ash_wraith', label: 'Ash Wraith', icon: '🔥', blurb: 'A cinder-grey wraith with ember eyes. It fills the caves with choking smoke-fog.',
    body: 'wraith', spec: {},
    colors: { body: '#3a3a3a', head: '#2e2e2e', arms: '#333333', hands: '#4a3a30' },
    patterns: { body: ['gradient', '#141414'] },
    paint: { eyeStyle: 'glow', eyeColor: '#ff7a1a', mouth: 'none', noise: 0.12 },
    style: 'shade', type: 'underground', time: 'always', appear: { firstAfter: 6, every: [9, 15], chance: 55 },
    stats: [35, 8, 0.28], sounds: [{ ambient: 'mob.blaze.breathe', hurt: 'mob.blaze.hit', death: 'mob.blaze.death' }, [0.5, 0.7]],
    loot: [pool('minecraft:coal', 1, 3), pool('minecraft:blaze_powder', 0, 1)], scares: { fogColor: '#2a1a10' }, weakFire: false,
  },
  {
    id: 'stitched_doll', label: 'Stitched Doll', icon: '🪆', blurb: 'A small doll with button eyes. It blinks closer every time you look away… then giggles.',
    body: 'doll', spec: {},
    colors: { body: '#5a4a6a', head: '#e9e4da', arms: '#e9e4da', hands: '#e9e4da', legs: '#e9e4da' },
    patterns: { body: ['stripes', '#7a6a8a'] },
    paint: { eyeStyle: 'button', eyeColor: '#1a1a1a', mouth: 'stitched', noise: 0.05 },
    style: 'shadow', type: 'surface', time: 'night', appear: { firstAfter: 5, every: [8, 14], chance: 60, distance: 'near' },
    stats: [20, 5, 0.38], sounds: [{ ambient: 'mob.allay.idle', hurt: 'mob.allay.hurt', death: 'mob.allay.death' }, [0.6, 0.8]],
    loot: [pool('minecraft:string', 1, 3), pool('minecraft:white_wool', 0, 1)],
  },
  {
    id: 'the_brute', label: 'The Brute', icon: '🦍', blurb: 'A mountain of grey flesh with a tiny head. Slow to notice, impossible to outrun once it does.',
    body: 'brute', spec: {},
    colors: { body: '#6b6660', head: '#7a756e', arms: '#625d57', hands: '#4a4642', legs: '#57524c' },
    patterns: { body: ['veins', '#3a3632'], arms: ['veins', '#3a3632'] },
    paint: { eyeStyle: 'glow', eyeColor: '#ffd23a', mouth: 'grin', noise: 0.1 },
    style: 'hunter', type: 'underground', time: 'always', appear: { firstAfter: 8, every: [10, 18], chance: 50 },
    stats: [90, 14, 0.27], sounds: [{ ambient: 'mob.ravager.ambient', hurt: 'mob.ravager.hurt', death: 'mob.ravager.death', step: 'mob.ravager.step' }, [0.5, 0.7]],
    loot: [pool('minecraft:iron_ingot', 1, 3)], tweak: (h) => { h.hunt.speed = 1.3; h.senses.detect = 24; },
  },
  {
    id: 'horned_lurker', label: 'Horned Lurker', icon: '😈', blurb: 'A red, horned climber with a spiked back. It scales cliffs and pounces when you look its way.',
    body: 'lurker', spec: { horns: true, spikes: true, hands: 'claws', clawLen: 5, headH: 10 },
    colors: { body: '#5a1a14', head: '#6a2018', arms: '#521712', hands: '#2a0c08', legs: '#4a1410', extra: '#2a0c08' },
    patterns: { body: ['grime', '#2a0806'] },
    paint: { eyeStyle: 'glow', eyeColor: '#ffe14a', mouth: 'bigGrin', toothColor: '#f2e6c8', noise: 0.08 },
    style: 'crawler', type: 'both', time: 'night', appear: { firstAfter: 6, every: [8, 14], chance: 60 },
    stats: [40, 9, 0.35], sounds: [{ ambient: 'mob.blaze.breathe', hurt: 'mob.ghast.charge', death: 'mob.ghast.death' }, [0.5, 0.7]],
    loot: [pool('minecraft:blaze_powder', 0, 2), pool('minecraft:bone', 1, 2)],
  },
];

// Old preset ids from Mobsmith 1.1 keep working.
export const DWELLER_ALIASES = { h_stalker: 'night_grinner', h_statue: 'still_one', h_crawler: 'ceiling_crawler', h_shade: 'hollow_shade', h_mimic: 'mimic', h_screamer: 'screamer' };

function bonesOf(model, key) {
  const m = { body: (b) => b.name === 'body', head: (b) => b.name === 'head', arms: (b) => /Arm(Lower)?$/.test(b.name), hands: (b) => /Hand$/.test(b.name), legs: (b) => /Leg$|^front|^back/.test(b.name) };
  return model.bones.filter(m[key] || (() => false));
}

/** Fills a fresh entity from a dweller preset. */
export function applyDwellerPreset(e, p, ns) {
  const d = DWELLER_BODIES[p.body];
  e.model = makeModel(p.body, { ...d.spec, ...p.spec }, p.colors);
  for (const [k, [pattern, color2]] of Object.entries(p.patterns || {})) {
    for (const b of bonesOf(e.model, k)) { b.pattern = pattern; if (color2) b.color2 = color2; }
  }
  e.autoPaint = { noise: 0.08, outline: true, eyes: true, ...p.paint };
  e.anims = defaultAnims(p.body);
  for (const [k, amp] of Object.entries(p.anims || {})) e.anims[k] = amp ? { ...e.anims[k], on: true, amp } : { ...e.anims[k], on: false };
  const [health, damage, speed] = p.stats;
  const col = d.collision;
  e.components = {
    'minecraft:type_family': { family: [e.name, 'monster', 'horror', 'mob'] },
    'minecraft:health': { value: health, max: health },
    'minecraft:movement': { value: speed },
    'minecraft:collision_box': { width: col[0], height: col[1] },
    'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
    'minecraft:nameable': {},
    'minecraft:pushable_by_entity': {},
    'minecraft:pushable_by_block': {},
    'minecraft:hurt_on_condition': { damage_conditions: [{ filters: { test: 'in_lava', subject: 'self' }, cause: 'lava', damage_per_tick: 4 }] },
    'minecraft:conditional_bandwidth_optimization': {},
    'minecraft:is_hidden_when_invisible': {},
    'minecraft:despawn': { despawn_from_distance: { min_distance: 64, max_distance: 128 } },
    'minecraft:experience_reward': { on_death: 'query.last_hit_by_player ? 15 : 0' },
    'minecraft:knockback_resistance': { value: 0.6 },
  };
  const h = defaultHorror();
  h.enabled = true;
  h.archetype = p.style;
  ARCHETYPES[p.style].apply(h);
  h.type = p.type;
  h.time = p.time;
  Object.assign(h.appear, p.appear || {});
  h.hunt.damage = damage;
  Object.assign(h.scares, p.scares || {});
  if (p.weakFire === false) h.weakness.fire = false;
  if (p.time === 'always') h.weakness.sunlight = 'none';
  if (p.tweak) p.tweak(h);
  e.horror = h;
  e.dwellerMode = 'horror';
  e.limit = { on: true, max: 1 };
  e.spawnCategory = 'monster';
  e.spawn = { enabled: false, population: 'monster', conditions: dwellerSpawn(h) };
  e.sounds = snd(p.sounds[0], p.sounds[1]);
  e.egg = { enabled: true, base: p.colors.body, overlay: p.paint.eyeColor || p.colors.head };
  e.loot = { enabled: true, pools: p.loot };
  e.preset = p.id;
  return e;
}

export function dwellerFromPreset(project, id, name, displayName) {
  const p = DWELLER_PRESETS.find((x) => x.id === (DWELLER_ALIASES[id] || id)) || DWELLER_PRESETS[0];
  const e = baseEntity(name || p.id, 'humanoid');
  e.displayName = displayName || p.label;
  return applyDwellerPreset(e, p, project.namespace);
}

/** Swaps only the look (model, paint, body animations, size) of a dweller, keeping its behaviour. */
export function applyDwellerLook(e, id) {
  const p = DWELLER_PRESETS.find((x) => x.id === (DWELLER_ALIASES[id] || id));
  if (!p) return e;
  const d = DWELLER_BODIES[p.body];
  e.model = makeModel(p.body, { ...d.spec, ...p.spec }, p.colors);
  for (const [k, [pattern, color2]] of Object.entries(p.patterns || {})) {
    for (const b of bonesOf(e.model, k)) { b.pattern = pattern; if (color2) b.color2 = color2; }
  }
  e.textures = [];
  e.autoPaint = { noise: 0.08, outline: true, eyes: true, ...p.paint };
  const keep = { custom: e.anims?.custom || [], imported: e.anims?.imported || [], slots: e.anims?.slots };
  e.anims = defaultAnims(p.body);
  for (const [k, amp] of Object.entries(p.anims || {})) e.anims[k] = amp ? { ...e.anims[k], on: true, amp } : { ...e.anims[k], on: false };
  Object.assign(e.anims, keep.slots ? keep : { custom: keep.custom, imported: keep.imported });
  e.components['minecraft:collision_box'] = { width: d.collision[0], height: d.collision[1] };
  e.egg = { ...(e.egg || {}), enabled: true, base: p.colors.body, overlay: p.paint.eyeColor || p.colors.head };
  return e;
}
