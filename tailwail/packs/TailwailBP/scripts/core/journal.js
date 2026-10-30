// The torn journal: pages unlock as the player lives through things.  Pure data.
// Each page is unlocked by a brain/presence flag; bits are stored in schedule.jr.

export const JOURNAL = [
  { flag: "presence", title: "Day 1", text: "Something in the caves repeats the sounds I make. A pickaxe on stone, a second later, deeper in. I stopped digging. It didn't." },
  { flag: "noticed", title: "The shape", text: "Tall. Too tall to fit down here, but it does. It folds itself. When I lit a torch it was just... standing there, at the edge of the light." },
  { flag: "creep", title: "Don't look away", text: "It only moves when you're not looking. Look away for a second and it's closer, in a different pose, like it was always standing that way." },
  { flag: "mirror", title: "It copies you", text: "I crouched. A second later, it crouched. Slower. Deeper. Wrong. It's rehearsing me." },
  { flag: "stared", title: "But don't stare", text: "Staring makes it angry. The clicking gets faster, the tail curls up over its back, the jaw starts to hang open. Then it stands up. All the way up." },
  { flag: "calm", title: "Walk away", text: "Backing off slowly while keeping my eyes on it worked. It let me go. It just watched." },
  { flag: "chase", title: "Run", text: "You can't outrun it in the open. Corners, gaps, water, anything it has to squeeze through. Break its line of sight." },
  { flag: "hid", title: "The dark is safer", text: "Crouched in the dark with no light on me, it walked right past. It was sniffing. It knows the smell of torches." },
  { flag: "grabbed", title: "It lifts you", text: "It picked me up like I weighed nothing and held me up to its face. It wanted me to look at it." },
  { flag: "struggle", title: "Fight it", text: "I kicked and kicked (JUMP, over and over) and it dropped me. It screamed like it was hurt." },
  { flag: "snuff", title: "Lights out", text: "My torches go out when it's near. The stick is still warm. Flint and steel lights them again, or another torch." },
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
