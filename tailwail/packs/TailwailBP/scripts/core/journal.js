// The torn journal: pages unlock as the player lives through things.  Pure data.
// Each page is unlocked by a brain/presence flag; bits are stored in schedule.jr.

export const JOURNAL = [
  { flag: "presence", title: "Day 1", text: "Something in the caves repeats the sounds I make. A pickaxe on stone, a second later, deeper in. I stopped digging. It didn't." },
  { flag: "noticed", title: "The shape", text: "Tall. Too tall to fit down here, but it does. It folds itself. It watched me from the edge of the light, and when I looked straight at it, it ran. On all fours. Fast." },
  { flag: "standoff", title: "Don't turn your back", text: "It creeps closer even while I watch it now. The moment I turned away it came at me. Staring only buys seconds." },
  { flag: "mirror", title: "It copies you", text: "I crouched. A second later, it crouched. Slower. Deeper. Wrong. It's rehearsing me." },
  { flag: "chase", title: "Run", text: "It is faster than me. Much faster. Corners, gaps, water, holes it can't fit into: anything that breaks its line of sight." },
  { flag: "hid", title: "The dark is safer", text: "Crouched in the dark with no light on me, it went right past. Sniffing. Listening. Don't break blocks. Don't open doors." },
  { flag: "grabbed", title: "It lifts you", text: "It picked me up like I weighed nothing and held me up to its face. It wanted me to look at it." },
  { flag: "struggle", title: "Fight it", text: "It's never the same twice. Kick (JUMP). Twist (SNEAK). Both, one after the other. It shifts its grip. Read what it wants, fast." },
  { flag: "still", title: "Go limp", text: "Once it told me not to move. I didn't. It sniffed me for a long time, and then it let me fall." },
  { flag: "snuff", title: "Lights out", text: "My torches go out when it's near. The stick is still warm. Flint and steel lights them again, or another torch." },
  { flag: "ceiling", title: "Look up", text: "It was on the ceiling. Flat, like a spider, with its face turned the right way up so it could watch me walk underneath." },
  { flag: "huddle", title: "The heap in the corner", text: "I took it for a mound of rock and hair. Then it turned around." },
  { flag: "climb", title: "Height won't save you", text: "I pillared up out of reach. It climbed the wall." },
  { flag: "smash", title: "Doors don't stop it", text: "I shut the door. It beat on it until it came apart. Glass is worse." },
  { flag: "wounded", title: "It can be hurt", text: "I hit it enough times and it ran, screaming. It will come back. It will remember." },
  { flag: "remembered", title: "It remembers", text: "It did the thing I did last time. Before I did it. It remembers." },
  { flag: "killed", title: "It can bleed", text: "It went down. I don't think it was the only one." },
];

export function journalBit(flag) {
  return JOURNAL.findIndex((p) => p.flag === flag);
}

/** Returns the new bitmask and whether a page was newly unlocked. */
export function unlock(mask, flag) {
  const i = journalBit(flag);
  if (i < 0) return { mask, added: null };
  const bit = 1 << i;
  if (mask & bit) return { mask, added: null };
  return { mask: mask | bit, added: JOURNAL[i] };
}
