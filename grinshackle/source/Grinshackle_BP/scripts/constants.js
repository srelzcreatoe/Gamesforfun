// Grinshackle — identifiers and fixed tables. Every other module imports names from here; never hard-code strings elsewhere.
export const IDS = Object.freeze({
  ENTITY: 'gs:grinshackle',
  LEGACY_ENTITY: 'cr:chainreaver',
  WAYPOINT: 'gs:waypoint',
  FAMILY: 'gs_grinshackle',
  WAYPOINT_FAMILY: 'gs_waypoint',
  TARGET_TAG: 'gs_target',
  ADMIN_TAG: 'gs_admin',
  SCRIPT_EVENT: 'gs:control',
  ITEM_DIAL: 'gs:chainbound_dial',
  ITEM_LURE: 'gs:rattle_lure',
  ITEM_CHAIN: 'gs:broken_chain',
  ITEM_SCRAP: 'gs:ink_scrap',
  ITEM_FANG: 'gs:grinshackle_fang',
  PROP_CONFIG: 'gs:config',
  PROP_RESERVATION: 'gs:reservation',
  PROP_OWNER: 'gs:owner',
  PROP_HISTORY: 'gs:history',
  PROP_PROFILE_PREFIX: 'gs:profile:',
  PROP_MIGRATED: 'gs:migrated_v1',
  ENT_GENERATION: 'gs:generation',
  ENT_MODE: 'gs:mode',
  ENT_POSE_SAVED: 'gs:pose_saved',
  PLAYER_PREFS: 'gs:prefs',
  PLAYER_LAST_DEATH: 'gs:lastDeathTick',
  PLAYER_LAST_SPAWN: 'gs:lastSpawnTick',
  P_POSE: 'gs:pose',
  P_ACTION: 'gs:action',
  P_OVERLAY: 'gs:overlay',
  P_TRACK: 'gs:track',
  OVERWORLD: 'minecraft:overworld',
});

export const POSES = Object.freeze(['hidden', 'emerge', 'idle', 'stalk', 'walk', 'run', 'crouch', 'crawl', 'stare', 'battle_idle', 'vanish', 'collapse']);

export const ACTIONS = Object.freeze({
  none: 0, alert: 1, twitch: 2, lunge: 3, chain_whip: 4, roar: 5, hurt: 6, chain_snap: 7, attack: 8, slam: 9, attack_crawl: 10,
});
export const ACTION_NAMES = Object.freeze(Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [v, k])));

export const OVERLAYS = Object.freeze({ none: 0, gather_chains: 1, tighten: 2 });

/** Clip table: ticks are authoritative for the server script (20 ticks = 1 s). */
export const CLIPS = Object.freeze({
  idle: { ticks: 102, loop: true }, battle_idle: { ticks: 58, loop: true }, stalk: { ticks: 38, loop: true }, walk: { ticks: 22, loop: true },
  run: { ticks: 12, loop: true }, stare: { ticks: 84, loop: true }, crouch: { ticks: 69, loop: true }, crawl: { ticks: 22, loop: true },
  alert: { ticks: 35, loop: false }, twitch: { ticks: 26, loop: false }, lunge: { ticks: 28, loop: false }, chain_whip: { ticks: 34, loop: false },
  roar: { ticks: 47, loop: false }, emerge: { ticks: 53, loop: false }, vanish: { ticks: 38, loop: 'hold' }, hurt: { ticks: 13, loop: false },
  collapse: { ticks: 46, loop: 'hold' }, chain_snap: { ticks: 44, loop: false }, attack: { ticks: 27, loop: false, impact: 12 },
  slam: { ticks: 35, loop: false, impact: 17 }, attack_crawl: { ticks: 23, loop: false, impact: 10 },
});
export const CLIP_NAMES = Object.freeze(Object.keys(CLIPS));
export const ANIM_PREFIX = 'animation.grinshackle_chainreaver.';

export const ATTACKS = Object.freeze({
  attack: { action: ACTIONS.attack, impact: 12, duration: 27, range: 1.8, damage: 10, facing: 0.45, vertical: 1.6, start: 1.7 },
  slam: { action: ACTIONS.slam, impact: 17, duration: 35, range: 1.7, damage: 12, facing: 0.45, vertical: 1.6, start: 1.6 },
  attack_crawl: { action: ACTIONS.attack_crawl, impact: 10, duration: 23, range: 1.95, damage: 9, facing: 0.45, vertical: 1.6, start: 1.8 },
});
export const MIN_ATTACK_GAP = 15;         // ticks between the end of one damaging attack and the next wind-up
export const HURT_COOLDOWN = 30;          // ticks between hurt reactions
export const ENRAGE_TICKS = 80;           // chain-snap enrage (4 s)
export const SNAP_COOLDOWN = 200;         // ticks between chain snaps
export const FRAGMENT_LIFE = 120;         // ticks a chain fragment stays
export const FRAGMENT_MAX = 12;
export const REAL_HEALTH_POOL = 1000;    // the entity's real health pool; the script keeps the configurable (default 80) virtual pool

export const DIRECTOR_STATES = Object.freeze(['DORMANT', 'OMENS', 'EMERGE', 'OBSERVE', 'INVESTIGATE', 'STALK', 'FLANK', 'WARNING', 'HUNT', 'SEARCH', 'RETREAT', 'COOLDOWN']);
export const VARIANTS = Object.freeze(['watcher', 'shadow', 'last_link', 'ambusher', 'feint']);
export const MODES = Object.freeze(['natural', 'test', 'egg', 'preview']);

export const MOTIONS = Object.freeze(['still', 'creep', 'stalk', 'walk', 'hunt', 'hunt_slow', 'hunt_fast', 'crawl', 'crawl_slow', 'crawl_fast', 'retreat']);
export const EVENTS = Object.freeze({
  move: (name) => 'gs:move_' + name,
  TARGET_PLAYER: 'gs:target_player', TARGET_WAYPOINT: 'gs:target_waypoint', TARGET_NONE: 'gs:target_none',
  CROUCH: 'gs:crouch', STAND: 'gs:stand',
});

export const SOUNDS = Object.freeze({
  chain_drag: 'gs.chain_drag', wrist_click: 'gs.wrist_click', breath: 'gs.breath', alert: 'gs.alert', answer_tap: 'gs.answer_tap',
  warning: 'gs.warning', windup: 'gs.windup', strike: 'gs.strike', impact: 'gs.impact', ink: 'gs.ink', defeat: 'gs.defeat',
  chain_snap: 'gs.chain_snap', roar: 'gs.roar', rattle: 'gs.rattle', lure: 'gs.lure', click_release: 'gs.click_release', hurt: 'gs.hurt',
  collapse_chains: 'gs.collapse_chains', step: (mat) => 'gs.step.' + mat, music_stalk: 'gs.music.stalk', music_hunt: 'gs.music.hunt',
});
export const STEP_MATERIALS = Object.freeze(['stone', 'deepslate', 'gravel', 'wood', 'dirt']);

export const PARTICLES = Object.freeze({
  ink_motes: 'gs:ink_motes', ink_drip: 'gs:ink_drip', ink_puff: 'gs:ink_puff', chain_fragment: 'gs:chain_fragment',
  collapse_chains: 'gs:collapse_chains', snap_sparks: 'gs:snap_sparks', lit_edge: 'gs:lit_edge',
});

/** Placed light sources counted by the light approximation (NOT a light-level reading). */
export const LIGHT_BLOCKS = /:(torch|wall_torch|underwater_torch|colored_torch_\w+|lantern|soul_lantern|soul_torch|glowstone|sea_lantern|shroomlight|redstone_lamp|lit_pumpkin|end_rod|beacon|campfire|soul_campfire|ochre_froglight|verdant_froglight|pearlescent_froglight|copper_bulb|lit_copper_bulb|\w*_copper_bulb)$/;
/** Mineshaft-like material heuristic (NOT structure recognition). */
export const MINESHAFT_BLOCKS = /:(oak_fence|oak_planks|dark_oak_fence|dark_oak_planks|rail|golden_rail|web|torch|chest|minecart)$/;
/** Blocks that never count as floor. */
export const NON_FLOOR = /(torch|grass|flower|vine|mushroom|rail|carpet|snow_layer|fence|wall|door|leaves|slab|stairs|fire|cactus|magma|lava|water|web|pointed_dripstone|amethyst_cluster|sculk_sensor|trapdoor|bed|button|lever|pressure_plate|sign|banner|glass_pane|iron_bars|chain|candle|air)/;
