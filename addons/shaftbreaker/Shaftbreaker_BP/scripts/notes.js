// @ts-check
/**
 * Field notes: a journal that fills in as you witness things (kept per player). Locked entries
 * show only a hint. Read them from the Breaker's Wheel.
 */
import { safe, valid } from './core/util.js';
import { profile, markDirty } from './ai/memory.js';

export const FIELD_NOTES = [
  { id: 'arrived', title: 'It came down after you', hint: 'Go underground, or stay out after dark, and wait.',
    text: 'About a minute after you go below ground it is down there too. You will not see it arrive. You will hear it: a click, a scrape, breathing that is not yours, and the sounds come from exactly where it is.' },
  { id: 'still', title: 'It does not move', hint: 'Look around you more often.',
    text: 'Sometimes it is simply standing there at the edge of your light, perfectly still, turned towards you. It was not there a moment ago.' },
  { id: 'ledge', title: 'Above you', hint: 'Look up from the bottom of a ravine or a tall cave.',
    text: 'It likes high ledges. From up there it watches you work, and it can drop on you faster than you can climb to it.' },
  { id: 'ceiling', title: 'Upside down', hint: 'Look up in tall chambers.',
    text: 'It hangs from cave ceilings head down, arms loose, and turns with you. If dust starts to fall, move out of the way.' },
  { id: 'behind', title: 'Turn around', hint: 'Turn around now and then.',
    text: 'You will turn around and it will be right there, a few blocks behind you. It has been there for a while.' },
  { id: 'ahead', title: 'It knew where you were going', hint: 'Keep walking the same way.',
    text: 'It reads which way you are heading and waits around the next corner. People who keep checking behind them find it ahead of them more often.' },
  { id: 'peek', title: 'Behind the trunk', hint: 'Watch the tree trunks at night, and the pillars underground.',
    text: 'It hides behind trees and pillars and peeks round them. Look at it and it ducks back. Look away and it peeks out again, from the other side.' },
  { id: 'standoff', title: 'The standoff', hint: 'Let it see that you have seen it.',
    text: 'When you spot it, sometimes it stays and tests you: a neck crack, a head tilt, one slow step while you watch.' },
  { id: 'creep', title: 'A little closer', hint: 'Look away from it during a standoff.',
    text: 'Every time you look away it is a little closer. Let it get close enough and it lunges the moment you look back.' },
  { id: 'stared', title: 'Do not stare it down', hint: 'What happens if you never look away?',
    text: 'Hold its gaze too long and it snaps. The more you stare at it, the less patience it has for it next time.' },
  { id: 'rage', title: 'Faster than you', hint: 'Make it angry.',
    text: 'When it snaps it screams, the air goes red and it comes faster than you can sprint, climbing walls and pillars to reach you. Nothing can touch you for about two seconds after the scream. Break its line of sight. Daylight ends it, except in its own land.' },
  { id: 'hurt', title: 'Do not hit it', hint: 'Hit it. (Not recommended.)',
    text: 'Striking it or shooting it makes it snap. It has a great deal of health, and it falls hard when it finally falls. If you mean to fight it, mean it.' },
  { id: 'charged', title: 'Do not run at it', hint: 'Run straight at it.',
    text: 'Rush it and it decides on the spot: it attacks, or it vanishes and comes back when you are weaker. The more often you rush it, the more often it stands its ground.' },
  { id: 'ambush', title: 'It came back', hint: 'Rush it and live.',
    text: 'Breathing right behind you, then the coil. It waits for a worse moment: when you are hurt, in the dark, on your own.' },
  { id: 'lunge', title: 'The lunge', hint: 'Be seen at the wrong moment.',
    text: 'A short coil and a growl, then it covers six blocks in a heartbeat. Move sideways on the growl.' },
  { id: 'close', title: 'Too close', hint: 'Walk right up to it.',
    text: 'Walk right up to it and it strikes. It does not need a reason.' },
  { id: 'jumpscare', title: 'Its face', hint: 'Turn around at the wrong moment.',
    text: 'Sometimes when you turn, it is not a few blocks away. It is in your face.' },
  { id: 'vanish', title: 'It vanishes where it stands', hint: 'Watch it leave.',
    text: 'It does not walk away. It is simply gone. That does not mean it left.' },
  { id: 'breach', title: 'Doors are not walls', hint: 'Shut a door on it.',
    text: 'It opens doors, gates and trapdoors, smashes glass and leaves, and crawls through one-block gaps. Shut yourself in and it goes for the nearest door or window. When it is over, every door is closed and every pane is back, as if it was never there.' },
  { id: 'knock', title: 'Do not open the door', hint: 'Stay inside at night.',
    text: 'At night, if you shut yourself in, it knocks. Then it waits on the other side of the door.' },
  { id: 'mimic', title: 'Your own sounds', hint: 'Listen while you work.',
    text: 'A door you did not open. Footsteps that stop when you stop. Someone eating in the dark. Your own pickaxe in another tunnel. It has been listening to you.' },
  { id: 'whisper', title: 'Whispers', hint: 'Spend time near it.',
    text: 'Whispers just behind your head. Sometimes words on your screen. Sometimes your name.' },
  { id: 'eyes', title: 'Two pale points', hint: 'Look into the dark you are not lighting.',
    text: 'Eyes in the dark, a face-width apart. They go out the moment you look straight at them.' },
  { id: 'den', title: 'Its dens', hint: 'Follow a shaft moth.',
    text: 'Chambers carpeted in grey dust and bone, the walls scored by its claws, spines hanging from the ceiling. Break the Den Heart and the territory goes quiet for a few days. It remembers who did that.' },
  { id: 'moth', title: 'Shaft moths', hint: 'Stay underground near a den.',
    text: 'A pale moth that leads you to its den, and waits and points when you fall behind.' },
  { id: 'hollows', title: 'The Hollows', hint: 'Find its land.',
    text: 'Its own land: grey dust, dead timber, old headframes over shafts that drop into the dark, cairns nobody living built. The fog never lifts, and here it walks by day.' },
  { id: 'defeat', title: 'It can be brought down', hint: 'Survive the unsurvivable.',
    text: 'Bring it down and it collapses. Its skull is yours to wear. It will come back.' },
];
const IDS = new Set(FIELD_NOTES.map((n) => n.id));
const TITLE = Object.fromEntries(FIELD_NOTES.map((n) => [n.id, n.title]));

export function unlockedNotes(player) {
  const pf = profile(player);
  return new Set(pf.fieldNotes || []);
}

/** a new journal entry (once per player) */
export function unlockNote(player, id) {
  if (!valid(player) || !IDS.has(id)) return false;
  const pf = profile(player);
  if (!pf.fieldNotes) pf.fieldNotes = [];
  if (pf.fieldNotes.includes(id)) return false;
  pf.fieldNotes.push(id);
  markDirty(player);
  safe('noteToast', () => player.sendMessage(`§8[Field notes] §7New entry: §f${TITLE[id]}§8  (use the Breaker's Wheel to read it)`));
  return true;
}

/** read what happened in a finished encounter and unlock what the player witnessed */
export function notesFromEncounter(player, tplId, tel) {
  const n = (tel.notes || []).join('|');
  const add = (id) => unlockNote(player, id);
  const shown = /show:(still|ledge|ceiling|behind|ahead|peek)/.exec(n);
  if (shown && tel.notes.includes('sighted')) add(shown[1]);
  if (/reaction:standoff|standoff:|test:/.test(n)) add('standoff');
  if (/crept to/.test(n) && /standoff:/.test(n)) add('creep');
  if (/rage \(stared down/.test(n)) add('stared');
  if (/rage \(/.test(n)) add('rage');
  if (/rage \(struck/.test(n)) add('hurt');
  if (/ran at it/.test(n)) add('charged');
  if (tplId === 'stalk_ambush') add('ambush');
  if (/\|?lunge(\||$)/.test(n)) add('lunge');
  if (/close strike/.test(n)) add('close');
  if (/jumpscare/.test(n)) add('jumpscare');
  if (/vanished in place|exit: vanished/.test(n)) add('vanish');
  if (/breach:/.test(n)) add('breach');
  if (tplId === 'knock_door') add('knock');
  if (tplId === 'mimic') add('mimic');
}
