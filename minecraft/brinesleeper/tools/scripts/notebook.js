// The Waterlogged Notebook: every player is handed one when they first join. A few short pages from someone who went
// down to the still water and did not come back, and on the last page, where the nearest still water is.
// As the Brinesleeper learns how you play (brain.js), new pages appear in it.
import { world, system, ItemStack } from '@minecraft/server';
import { config } from './config.js';
import { BIOME } from './areas.js';
import { starterHall } from './halls.js';

const TITLE = 'Waterlogged Notebook';
const PAGES = [
  '§8Day 1§r\n\nThe dripstone caves sing when it rains.\n\nUnder them, the water does not move.\n\nNothing lives in still water.\n\n§oSomething does.',
  "§8Day 4§r\n\nI saw it in the lake. Only its head above the water.\n\nWhen I looked, it was gone.\n\nThe ripples kept coming toward me.",
  "§8Day 6§r\n\nWhat I know:\n\n§0Don't stare at it.\nDon't look away for long.\nStay out of deep water.\nKeep your lights close.\n§rIt takes them.",
  '§8Day 9§r\n\nIt is learning.\n\nI looked behind me,\nso it came from below.\n\nI ran,\nso it ran faster.',
  '§8Day 12§r\n\nI left the caves.\n\nThe pond by my door was very still this morning.\n\n§oIt followed me home.',
];
// pages it writes itself, as it learns you (brain.js calls addEntry with one of these keys)
export const ENTRIES = {
  looks: '§8It knows§r\n\nYou look behind you when you are afraid.\n\nIt waits until you stop.',
  lights: '§8It knows§r\n\nYou carry light into the dark.\n\nIt has started putting it out.',
  runs: '§8It knows§r\n\nYou run.\n\nIt was never slower than you. It was letting you.',
  swims: '§8It knows§r\n\nYou swim.\n\nYou are never alone in the water.',
  fights: '§8It knows§r\n\nYou fight.\n\nIt will not give you time to.',
  bold: '§8It knows§r\n\nIt is not afraid of you anymore.',
  follows: '§8It knows§r\n\nIt left the still water.\n\nIt is looking for you.',
  home: '§8It knows§r\n\nWhere you sleep.',
  kill: "§8It knows§r\n\nYou killed one.\n\n§oYou didn't think it was the only one.",
};

function compass(from, to) {
  const a = Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI;        // +x east, +z south
  return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(a / 45) % 8) + 8) % 8];
}
/** the nearest still water: the natural caves (from the world seed) or the starter hall's well, whichever is closer */
function nearest(player) {
  const p = player.location;
  let best;
  for (const size of [2400, 6000]) {
    try {
      const at = player.dimension.calculateClosestBiomeFromSeed(p, BIOME, { boundingSize: { x: size, y: 384, z: size } });
      if (at) { best = { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z), well: false }; break; }
    } catch (e) { /* not this dimension */ }
  }
  const s = starterHall();
  if (s) {
    const w = s.wellAt ?? { x: s.x + 42, y: undefined, z: s.z - 1 };
    const d = (q) => Math.hypot(q.x - p.x, q.z - p.z);
    if (!best || d(w) < d(best)) best = { x: Math.round(w.x), y: w.y ?? '?', z: Math.round(w.z), well: true };
  }
  return best;
}
function lastPage(player) {
  const n = nearest(player);
  if (!n) return '§8The still water§r\n\nI could not find it again.\n\nListen for it.\n\n§oIt will find you.';
  const dist = Math.round(Math.hypot(n.x - player.location.x, n.z - player.location.z));
  return `§8The still water§r\n\nX ${n.x}\nY ${n.y}\nZ ${n.z}\n\n${dist} blocks ${compass(player.location, n)} of where you woke.\n\n` +
    (n.well ? 'Find the old well.\nGo down.\n\n' : '') + "§oDon't go.";
}

function makeBook(player) {
  const book = new ItemStack('minecraft:written_book', 1);
  const c = book.getComponent('minecraft:book');
  const learned = (() => { try { return JSON.parse(String(player.getDynamicProperty('brine:entries') ?? '[]')); } catch (e) { return []; } })();
  const pages = [...PAGES, ...learned.map((k) => ENTRIES[k]).filter(Boolean), String(player.getDynamicProperty('brine:lastpage') ?? lastPage(player))];
  c?.setContents(pages);
  c?.signBook(TITLE, 'M.');
  return book;
}
/** hand the player their notebook; `refresh` rewrites the last page from where they stand now */
export function giveNotebook(player, refresh = false) {
  try {
    if (refresh || !player.getDynamicProperty('brine:lastpage')) player.setDynamicProperty('brine:lastpage', lastPage(player));
    player.getComponent('minecraft:inventory')?.container?.addItem(makeBook(player));
  } catch (e) { /* inventory full */ }
}
/** a new page: written once, and every notebook the player carries is rewritten to include it */
export function addEntry(player, key) {
  if (!ENTRIES[key]) return;
  let learned = [];
  try { learned = JSON.parse(String(player.getDynamicProperty('brine:entries') ?? '[]')); } catch (e) { learned = []; }
  if (learned.includes(key)) return;
  learned.push(key);
  player.setDynamicProperty('brine:entries', JSON.stringify(learned));
  const inv = player.getComponent('minecraft:inventory')?.container;
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it?.typeId === 'minecraft:written_book' && it.getComponent('minecraft:book')?.title === TITLE) {
      inv.setItem(i, makeBook(player));
      try { player.onScreenDisplay.setActionBar('§8§oA new page in your notebook is wet.'); } catch (e) { /* ok */ }
    }
  }
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || !config.notebook || player.getDynamicProperty('brine:notebook')) return;
  system.runTimeout(() => {                               // after the starter hall has been placed
    if (!player.isValid) return;
    player.setDynamicProperty('brine:notebook', true);
    giveNotebook(player);
  }, 120);
});
