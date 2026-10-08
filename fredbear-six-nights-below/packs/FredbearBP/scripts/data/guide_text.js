// SHIFT GUIDE (the guide item and the lobby terminal): one page per mechanic.
// Every number is computed from CONFIG / data, so the guide always matches the
// game. Pure data - no Minecraft imports.

import { CONFIG, TPS } from '../core/config.js';
import { CAMERAS } from './cameras.js';
import { TASKS, MAINTENANCE } from './story.js';

const P = CONFIG.power;
const D = CONFIG.devices;
const C = CONFIG.characters;
const N = CONFIG.nights;
const FP = CONFIG.fredbearPowers;
const sec = (ticks) => `${Math.round((ticks / TPS) * 10) / 10} s`;
const pctPerSec = (units) => `${((units * TPS) / P.unitsPerPercent).toFixed(2)}%/s`;
const pct = (units) => `${units / P.unitsPerPercent}%`;
const range = (fn, a, b) => `${sec(fn(a))} (aggression ${a}) to ${sec(fn(b))} (aggression ${b})`;
const H = (t) => `§l§6${t}§r`;

const camLines = CAMERAS.map((c) => {
  const notes = [c.audioOnly ? 'audio only' : '', c.lostSignalBefore ? `no signal before night ${c.lostSignalBefore}` : ''].filter(Boolean).join(', ');
  return `• ${c.label}${notes ? ` §7(${notes})§r` : ''}`;
});

const nightLines = [1, 2, 3, 4, 5, 6].map((n) => {
  const d = N[n];
  return `${H(d.title)}\n${d.mechanic}. Strobe charges: ${d.strobeCharges}. Emergency reserve: ${d.reserve ? 'yes' : 'no'}.`;
});

export const GUIDE_SECTIONS = Object.freeze([
  {
    title: 'Your job',
    body: [
      `${H('Survive from 12 AM to 6 AM')} in the Security Office. A night lasts ${CONFIG.clock.hours} in-game hours of ${sec(CONFIG.clock.ticksPerHour)} each (${Math.round((CONFIG.clock.hours * CONFIG.clock.ticksPerHour) / TPS / 60)} minutes). If the game lags, the clock slows down with it.`,
      `${H('6 AM always wins')}: the moment the clock reaches 6 AM the night is over, even if an animatronic was about to attack. Only an attack that already started can still end the night.`,
      `${H('You lose')} if an animatronic gets into the office through an open entry, or if Freddy reaches you after the power runs out.`,
      `${H('Every attack is announced')}: before any jumpscare the animatronic stands at an entry for a while (its warning window). If that entry is closed in time, the attack fails.`,
      'Winning a night unlocks the next one at the time clock. Progress is saved in the world.',
      '§7The night keeps running while this guide or any menu is open.§r',
    ].join('\n\n'),
  },
  {
    title: 'Controls',
    body: [
      `${H('Office console')}: walk up and press the buttons (use / right-click / tap). Every button gives feedback: it works, it is unavailable (with the reason) or it is cooling down.`,
      `${H('Camera monitor')}: press the dark MONITOR button, a camera MAP button, or use the Camera Tablet. Change camera by scrolling the hotbar / pressing number keys / LB-RB, by pressing a map button, or from the tablet menu. Lower the monitor by SNEAKING, pressing MONITOR again, or from the tablet menu.`,
      `${H('Your items')} (locked in your hotbar):\n• Camera Tablet: raises the monitor; while it is up, opens the camera list.\n• Office Remote: a menu with every office control (an alternative to walking to the console).\n• Shift Guide: this guide.\nOn touch screens these items show an on-screen button.`,
      `${H('While the monitor is up')} you cannot walk or jump; sneak to come back.`,
    ].join('\n\n'),
  },
  {
    title: 'Power',
    body: [
      `You start each night with ${pct(P.start)} power (${pct(P.start + P.taskBonus)} after a power task). The power meter above the console has 10 lamps; the action bar shows the exact % and usage bars.`,
      `${H('Always on')}: ${pctPerSec(P.baseDrain[1])} on nights 1, ${pctPerSec(P.baseDrain[2])} from night 2.`,
      `${H('Extra drain while active')}:\n• each closed door: ${pctPerSec(P.door)}\n• each lit hall light: ${pctPerSec(P.light)}\n• camera monitor up: ${pctPerSec(P.cams)}\n• office hatch sealed: ${pctPerSec(P.hatch)}\n• emergency strobe: ${pct(P.strobeCost)} per shot\n• breaker reset: ${pct(P.breakerResetCost)}`,
      `${H('At 0%')}: everything switches off and the doors open. From night 3 you then have ${sec(P.reserveWindow)} to pull the EMERGENCY RESERVE lever for one ${pct(P.reserveAmount)} top-up. Otherwise a music box plays at the left door, the lights die, and Freddy comes - unless 6 AM arrives first.`,
      'Tip: doing nothing costs little; keeping doors shut all night is what empties the battery.',
    ].join('\n\n'),
  },
  {
    title: 'Doors',
    body: [
      `The two red buttons close the LEFT and RIGHT steel doors. A closed door stops Bonnie, Chica and Freddy at that side: if it stays closed while one of them waits there, they give up and leave. It costs ${pctPerSec(P.door)} per door while closed.`,
      `A door can be toggled every ${sec(D.doorDebounce)}. Open doors still keep you inside the office (an invisible barrier); they just do not stop animatronics.`,
      `Fredbear can force a closed door or the hatch open: it shows as JAMMED (red indicator) for ${sec(D.jamTicks)} and cannot be closed during that time. Use the strobe (see Fredbear).`,
      'Door indicator above each door: green = open, yellow = closed, red = being forced or jammed.',
    ].join('\n\n'),
  },
  {
    title: 'Hall lights',
    body: [
      `The white buttons light the corner just outside each door for ${sec(D.lightAutoOff)}, then switch off by themselves. Look through the office windows next to the doors: if someone stands in the lit corner, close that door.`,
      `Each lit light costs ${pctPerSec(P.light)}. The corners are dark otherwise, and the corner cameras (CAM 08 / CAM 13) look straight at them too.`,
      'If both lights stop working, Chica has tripped the breaker: press RESET BREAKER.',
    ].join('\n\n'),
  },
  {
    title: 'Cameras',
    body: [
      `${H('16 security cameras')}, one feed at a time:\n${camLines.join('\n')}`,
      `${H('Reading the feeds')}:\n• Static and a glitch sound: Fredbear is disrupting the cameras for a few seconds.\n• A purple, scan-lined figure: a false ECHO of Fredbear (night 5+). It is not real and cannot hurt you.\n• "No signal": that camera is not working yet.\n• CAM 10 Kitchen is audio only: you can hear Chica's pots and pans through it.`,
      `${H('Cameras matter to the animatronics')}: Freddy cannot move while the feed you watch shows him; Bonnie gets restless if you stare at him; Fredbear disrupts the cameras more often while you watch them. The monitor costs ${pctPerSec(P.cams)}.`,
      'Blind spots: the supply-closet vent and the shaft under the office hatch are not on any camera, and the basement is only partly covered (CAM 15 tunnel, CAM 16 diner). Listen for footsteps, clanks and music boxes.',
    ].join('\n\n'),
  },
  {
    title: 'Office hatch',
    body: [
      'From night 4 a floor hatch behind your chair opens onto the basement. Fredbear climbs up through it.',
      `The gold HATCH button seals it (${pctPerSec(P.hatch)} while sealed). It works like a third door, but only against Fredbear. A golden glow and a music box under the floor mean he is at the hatch.`,
      'Hatch indicators on the back wall: yellow = sealed, red = being forced or jammed.',
    ].join('\n\n'),
  },
  {
    title: 'Emergency strobe',
    body: [
      `The orange STROBE button fires a blinding flash (${pct(P.strobeCost)} power, ${sec(D.strobeCooldown)} cooldown). Charges per night: ${[4, 5, 6].map((n) => `night ${n}: ${N[n].strobeCharges}`).join(', ')} (the lamps on the panel show what is left).`,
      `${H('It only works on Fredbear, and only when the entry he is at is CLOSED (or jammed)')}: close that door or hatch first, then strobe. He is driven back to the diner.`,
      `A strobe while that entry is open only stuns him for ${sec(C.fredbear.stunTicks)} (once per attempt). A strobe with nobody there is wasted.`,
    ].join('\n\n'),
  },
  {
    title: 'Breaker, reserve, phone',
    body: [
      `${H('RESET BREAKER')}: Chica can trip the hall-light breaker from the kitchen (both lights stop working; the breaker lamp turns red). Press RESET BREAKER: it takes ${sec(D.breakerResetTicks)} and costs ${pct(P.breakerResetCost)}. Doors, cameras and the strobe are never affected.`,
      `${H('EMERGENCY RESERVE')} (lever on the back wall, night 3+): when the power hits 0% you have ${sec(P.reserveWindow)} to pull it for ${pct(P.reserveAmount)}. Once per night.`,
      `${H('PHONE')}: replays tonight's phone call. The calls explain what is new each night.`,
      `${H('START / RESUME')} (back wall): starts your shift after the introduction, and resumes the night after a maintenance task.`,
    ].join('\n\n'),
  },
  {
    title: 'Panel and indicators',
    body: [
      '• Power meter: 10 lamps above the console, one goes dark per 10%.',
      '• Hour lamps: one more lights up every in-game hour.',
      '• Door indicators (above each door): green open, yellow closed, red forced/jammed.',
      '• Light indicators: green on, grey off.',
      '• Hatch, breaker and strobe-charge lamps on the back wall: yellow sealed / resetting, red tripped / forced, one lamp per strobe charge.',
      '• Action bar: time, power %, usage bars and captions for every sound cue (captions can be switched off in SETTINGS).',
    ].join('\n'),
  },
  {
    title: 'Maintenance and tasks',
    body: [
      `${H('Maintenance (nights 3 and 5)')}: at a set time the clock stops and every animatronic shuts down. The doors open and green sparkles lead you to the job:\n• ${MAINTENANCE.generator.title}: ${MAINTENANCE.generator.hint}.\n• ${MAINTENANCE.electrical.title}: ${MAINTENANCE.electrical.hint}.\nPull the lever, walk back (or use the menu to return) and press START/RESUME. Nothing can attack you during maintenance, and you get a short grace period afterwards.`,
      `${H('Optional pre-shift tasks')} (during the introduction, before START SHIFT):\n${Object.entries(TASKS).map(([n, t]) => `• Night ${n}: ${t.text.replace(/^Optional: /, '')} Reward: ${t.reward === 'power' ? `start at ${pct(P.start + P.taskBonus)} power` : '+1 strobe charge'}.`).join('\n')}`,
      `${H('Following the sparkles')}: the green sparkles always follow a walkable route (doors, corridors, stairs). The action bar shows how many blocks are left.`,
    ].join('\n\n'),
  },
  {
    title: 'Bonnie',
    body: [
      'The purple rabbit. Fast and aggressive; usually comes to the LEFT door down the West Hall.',
      `${H('Warning')}: metallic footsteps, a groan, his silhouette in the lit left corner. He waits there for ${range(C.bonnie.telegraph, 3, 20)} before attacking.`,
      `${H('Counter')}: close the left door while he is there. Keeping it closed for ${sec(C.bonnie.repelTicks)} sends him away.`,
      `${H('Tricks')}: from aggression ${C.bonnie.flankMinAI} (night 2 on) he can circle round to the RIGHT door, more likely if you keep defending one side. From aggression ${C.bonnie.ventMinAI} he crawls through the supply-closet vent to the left door, out of camera view - a metal clank in the vent gives him away. Staring at him on camera makes him move sooner.`,
    ].join('\n\n'),
  },
  {
    title: 'Chica',
    body: [
      'The yellow chicken. Comes to the RIGHT door through the kitchen and the east side.',
      `${H('Tells')}: pots-and-pans clatter means she is in the KITCHEN (only she makes that sound; listen on CAM 10). Heavy breathing at the right door means she is there. She waits ${range(C.chica.telegraph, 2, 20)} before attacking.`,
      `${H('Counter')}: close the right door while she is there; ${sec(C.chica.repelTicks)} closed sends her back to the kitchen.`,
      `${H('Sabotage')}: while in the kitchen she may trip the hall-light breaker (up to ${N[6].maxSabotage} times a night, at least ${sec(C.chica.sabotageCooldown)} apart). Press RESET BREAKER.`,
    ].join('\n\n'),
  },
  {
    title: 'Freddy',
    body: [
      'The brown bear. Slow, patient, and comes to the RIGHT door corner through dark rooms.',
      `${H('Rules')}: he never moves while the camera you are watching shows him. If you ignore him, he gets bolder (+1 aggression for every ${sec(C.freddy.ignoreBonusEvery)} unwatched, up to +${C.freddy.ignoreBonusMax}); looking at him calms him down. A deep laugh means he moved closer.`,
      `${H('At the right corner')} (glowing eyes in the right window):\n• Close the right door for ${sec(C.freddy.repelTicks)} and he leaves.\n• Do NOT use the cameras with the right door open while he is there: after ${sec(C.freddy.slipTicks)} he slips into the office and attacks as soon as you lower the monitor.\n• Leave the door open and he attacks after ${range(C.freddy.patience, 1, 20)}.`,
      `${H('Power out')}: when the power runs out, Freddy plays a music box at the left door, then everything goes dark, then he attacks - unless 6 AM comes first.`,
    ].join('\n\n'),
  },
  {
    title: 'Fredbear',
    body: [
      `${H('The golden bear')}. Nights 1-3 you may only glimpse him on camera. From night 4 he hunts you: night 4 only through the floor HATCH; nights 5-6 through the left door, the right door or the hatch.`,
      `${H('Warning')}: a music box and a golden glow at the entry he chose. You then have ${range(C.fredbear.w1, 5, 20)} to CLOSE THAT ENTRY.`,
      `${H('Counter')}: entry closed + STROBE = he is repelled back to the diner. If the entry stays closed but you do not strobe, he pounds on it for ${range(C.fredbear.w2, 5, 20)} and then forces it open (JAMMED): you get one last ${sec(C.fredbear.w3)} to strobe him. He never gets through a closed entry without forcing it first.`,
      `${H('His powers')} (night 4 only the first):\n• Camera disruption: static on every feed for ${sec(FP.disrupt.duration[1])}-${sec(FP.disrupt.duration[3])}.\n• False camera: a purple ECHO of him appears on a camera where he is not, for ${sec(FP.false_cam.duration[2])}.\n• Blackout: an electrical whine, then the office lights and monitor fail for ${sec(FP.blackout.duration[2])}-${sec(FP.blackout.duration[3])}. Doors still work, and the warning windows (Bonnie, Chica, Freddy at the corner, Fredbear's music box) pause until the lights return.\n• Teleport: a chime, a golden shimmer and static on the destination camera warn you ${sec(C.fredbear.relocateWarn)} before he appears somewhere else.`,
      `${H('Mercy')}: after you repel him ${N[4].fredbear.maxAttempts} / ${N[5].fredbear.maxAttempts} / ${N[6].fredbear.maxAttempts} times (nights 4 / 5 / 6) he stays in the diner for the rest of the night.`,
      `${H('Night 6 - The Golden Hour')}: at 5 AM the other three go back to the stage and Fredbear rises again with ${N[6].fredbear.finale.extraAttempts} more attempts; you get ${N[6].fredbear.finale.extraCharges} extra strobe charges.`,
    ].join('\n\n'),
  },
  {
    title: 'Sounds to listen for',
    body: [
      '• Metallic footsteps (side shown in captions): someone is walking near the office.',
      '• Groan at the left: Bonnie in the corner. Vent clank: Bonnie in the vent.',
      '• Pots and pans: Chica in the kitchen. Breathing at the right: Chica at the door.',
      '• Deep laughter: Freddy moved closer.',
      '• Music box at an entry: Fredbear is there - close it, then strobe.',
      '• Music box at the left door with no power: Freddy, power out.',
      '• Chime and shimmer: Fredbear is about to teleport.',
      '• Electrical whine: a blackout in 2 seconds. Glitch: camera disruption.',
      '• Door bangs: something is pounding on a closed entry (or just left).',
    ].join('\n'),
  },
  {
    title: 'The six nights',
    body: nightLines.join('\n\n'),
  },
  {
    title: 'Lobby, free roam and settings',
    body: [
      `${H('Time clock')}: choose any unlocked night, the TRAINING SHIFT (a safe practice night), CONTINUE, or FREE ROAM.`,
      `${H('Free roam')}: explore the whole building safely - no animatronic moves. 12 secrets are hidden around the map; ARCHIVE & CREDITS lists the ones you found.`,
      `${H('Settings')}: captions for every sound cue, hints, a fixed seed (the same night plays out the same way every time) and a developer overlay.`,
      `${H('Leaving mid-night')}: if you quit during a night, the night is abandoned and you return to the time clock next time. Unlocked nights and secrets are kept.`,
    ].join('\n\n'),
  },
]);
