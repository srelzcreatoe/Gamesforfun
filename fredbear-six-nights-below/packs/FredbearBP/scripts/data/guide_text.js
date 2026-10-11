// SHIFT GUIDE (the guide item and the lobby terminal): one page per mechanic.
// Every number is computed from CONFIG / data, so the guide always matches the
// game. Pure data - no Minecraft imports.

import { CONFIG, TPS } from '../core/config.js';
import { CAMERAS } from './cameras.js';
import { TASKS, MAINTENANCE, CLIPPINGS } from './story.js';

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

const nightLines = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
  const d = N[n];
  const variants = d.variants ? `\n${Object.values(d.variants).map((v) => `• ${v.title.replace(/^Night \d+ — /, '')}: ${v.mechanic}.`).join('\n')}` : '';
  return `${H(d.title)}\n${d.mechanic}.${variants}${variants ? '\n' : ' '}Strobe charges: ${d.strobeCharges}. Emergency reserve: ${d.reserve ? 'yes' : 'no'}.`;
});
const SE = CONFIG.seals;
// "0.06%/s on nights 1, 8, 9; 0.08%/s on nights 2, 3, 4, 7; ..." from the drain table.
const drainLines = (() => {
  const groups = new Map();
  for (let n = 1; n <= 9; n++) groups.set(P.baseDrain[n], [...(groups.get(P.baseDrain[n]) ?? []), n]);
  return [...groups].map(([u, ns]) => `${pctPerSec(u)} on night${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`).join('; ');
})();

export const GUIDE_SECTIONS = Object.freeze([
  {
    title: 'Your job',
    body: [
      `${H('Survive from 12 AM to 6 AM')} in the Security Office. A night lasts ${CONFIG.clock.hours} in-game hours of ${sec(CONFIG.clock.ticksPerHour)} each (${Math.round((CONFIG.clock.hours * CONFIG.clock.ticksPerHour) / TPS / 60)} minutes). If the game lags, the clock slows down with it.`,
      `${H('6 AM always wins')}: the moment the clock reaches 6 AM the night is over, even if an animatronic was about to attack. Only an attack that already started can still end the night.`,
      `${H('You lose')} if an animatronic gets into the office through an open entry, or if Freddy (Fredbear from night 4) reaches you after the power runs out.`,
      `${H('Every attack is announced')}: before any jumpscare the animatronic stands at an entry for a while (its warning window). If that entry is closed in time, the attack fails.`,
      'Winning a night unlocks the next one at the time clock. Beating night 6 opens night 7 and the CHALLENGES; night 7 opens night 8, and night 8 opens night 9. Progress is saved in the world.',
      `${H('Night music')}: "Pizza Dinner" plays from 12 AM to 6 AM in place of Minecraft's own music (other sounds are not affected). It stops when the power goes out. Switch it off or on with the first button of this guide or in SETTINGS; it follows your Music volume slider.`,
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
      `${H('Camera map')}: while you watch the cameras a map of the building sits in the bottom-right corner, every camera a labelled box and the one you are on highlighted (switch it off in SETTINGS).`,
    ].join('\n\n'),
  },
  {
    title: 'Power',
    body: [
      `You start each night with ${pct(P.start)} power (${pct(P.start + P.taskBonus)} after a power task). The power meter above the console has 10 lamps; the action bar shows the exact % and usage bars.`,
      `${H('Always on')}: ${drainLines}.`,
      `${H('Extra drain while active')}:\n• each closed door: ${pctPerSec(P.door)}\n• each lit hall light: ${pctPerSec(P.light)}\n• camera monitor up: ${pctPerSec(P.cams)}\n• office hatch sealed: ${pctPerSec(P.hatch)}\n• vent or shaft seal: ${pct(SE.cost)} per use\n• emergency strobe: ${pct(P.strobeCost)} per shot\n• breaker reset: ${pct(P.breakerResetCost)}`,
      `${H('At 0%')}: everything switches off and the doors open. From night 3 you then have ${sec(P.reserveWindow)} to pull the EMERGENCY RESERVE lever for one ${pct(P.reserveAmount)} top-up. Otherwise a music box plays at the left door, the lights die, and someone comes - Freddy on nights 1-3, Fredbear (golden eyes in the dark doorway) from night 4 - unless 6 AM arrives first.`,
      'Tip: doing nothing costs little; keeping doors shut all night is what empties the battery.',
    ].join('\n\n'),
  },
  {
    title: 'Doors',
    body: [
      `The two red buttons close the LEFT and RIGHT steel doors. A closed door stops Bonnie, Chica and Freddy at that side: if it stays closed while one of them waits there, they give up and leave. It costs ${pctPerSec(P.door)} per door while closed.`,
      `A door can be toggled every ${sec(D.doorDebounce)}. Open doors still keep you inside the office (an invisible barrier); they just do not stop animatronics.`,
      `${H('Against Fredbear')}: each door and the hatch can hold him off ONCE per night - he pounds on it, gives up and bows out. The next time he comes to that same door or hatch he forces it open: it shows as JAMMED (red indicator) for ${sec(D.jamTicks)} and cannot be closed during that time. Use the strobe (see Fredbear). At 5 AM on night 6 (the Golden Hour) nothing holds him.`,
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
      `${H(`${CAMERAS.length} security cameras`)}, one feed at a time:\n${camLines.join('\n')}`,
      `${H('Reading the feeds')}:\n• Static and a glitch sound: Fredbear is disrupting the cameras for a few seconds.\n• A purple, scan-lined figure: a false ECHO of Fredbear (night 5+). It is not real and cannot hurt you.\n• A pitch-black silhouette on the stage (CAM 01 / CAM 02, rare, night 2+): Shadow Fredbear. Do not stare at it - after ${sec(CONFIG.shadow.stareTicks)} of watching it vanishes and takes ${pct(CONFIG.shadow.drain)} of your power with it.\n• "No signal": that camera is not working yet.\n• CAM 10 Kitchen is audio only: you can hear Chica's pots and pans through it.\n• The low electrical hum is the camera system itself.\n• They stare back: whoever you watch on a feed for a couple of seconds slowly turns to look straight into the lens. It means nothing. Probably.`,
      `${H('11:55 camera tour')}: before each night the cameras show where everyone starts. Sneak to skip it.`,
      `${H('Cameras matter to the animatronics')}: Freddy cannot move while the feed you watch shows him; Bonnie gets restless if you stare at him; Fredbear disrupts the cameras more often while you watch them. The monitor costs ${pctPerSec(P.cams)}.`,
      'The supply duct (CAM 18) and the subfloor under the office hatch (CAM 17) show Bonnie in the vent and Fredbear (or Morgrave) climbing toward the hatch. The sealed diner has CAM 16, 19, 20 and 21 (from night 4). Blind spots remain - the far end of the vent, the shaft itself, the dark corners: listen for footsteps, clanks and music boxes.',
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
    title: 'Vent seals',
    body: [
      `${H('SEAL VENT')} (white button left of the console) and ${H('SEAL SHAFT')} (gold, from night 4) drop a steel shutter into the supply duct or into the crawlspace below the office for ${sec(SE.duration)}. Each use costs ${pct(SE.cost)} power; then the seal needs ${sec(SE.cooldown)} to recharge. The lamps above the buttons are yellow while sealed.`,
      `${H('What they stop')}: Bonnie crawling through the vent, and Morgrave (night 8 / 9) in the duct or the crawlspace - if he finds the way sealed for ${sec(C.morgrave.sealGiveUp)} he gives up. Fredbear's teleports are not stopped; his walk through the shaft is.`,
      'Watch CAM 18 (duct) and CAM 17 (subfloor) and seal when something is in there: cheaper than holding a door shut.',
    ].join('\n\n'),
  },
  {
    title: 'Emergency strobe',
    body: [
      `The orange STROBE button fires a blinding flash (${pct(P.strobeCost)} power, ${sec(D.strobeCooldown)} cooldown). Charges per night: ${[4, 5, 6, 7].map((n) => `night ${n}: ${N[n].strobeCharges}`).join(', ')}, plus ${N[6].fredbear.finale.extraCharges} at 5 AM on night 6 - always a couple more than his attempts, so one miss is not fatal. The lamps on the panel show up to 4; the action bar shows the exact count.`,
      `${H('It only works on Fredbear, and only when the entry he is at is CLOSED (or jammed)')}: close that door or hatch first, then strobe. He is driven back to the diner, every time.`,
      `${H('Saving a charge')}: the first time he pounds on a given door or the hatch, it holds by itself and he leaves. You can let that happen instead of strobing - but it only works once per door and per the hatch each night.`,
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
      `${H('Tricks')}: from aggression ${C.bonnie.flankMinAI} (night 2 on) he can circle round to the RIGHT door, more likely if you keep defending one side. From aggression ${C.bonnie.ventMinAI} he crawls through the supply-closet vent to the left door - a metal clank in the vent gives him away, CAM 18 shows him in the duct, and SEAL VENT keeps him out. Staring at him on camera makes him move sooner.`,
      `${H('Teamwork')} (aggression ${C.bonnie.teamworkMinAI}+): sometimes he bangs on the LEFT door to draw your eyes while Chica sneaks to the RIGHT one without a sound. When the banging starts, check the right light too.`,
    ].join('\n\n'),
  },
  {
    title: 'Chica',
    body: [
      'The yellow chicken. Comes to the RIGHT door through the kitchen and the east side.',
      `${H('Tells')}: pots-and-pans clatter means she is in the KITCHEN (only she makes that sound; listen on CAM 10). Heavy breathing at the right door means she is there. She waits ${range(C.chica.telegraph, 2, 20)} before attacking.`,
      `${H('Counter')}: close the right door while she is there; ${sec(C.chica.repelTicks)} closed sends her back to the kitchen.`,
      `${H('Sabotage')}: while in the kitchen she may trip the hall-light breaker (up to ${N[6].maxSabotage} times a night, at least ${sec(C.chica.sabotageCooldown)} apart). Press RESET BREAKER.`,
      `${H('Flanking')} (aggression ${C.chica.flankMinAI}+): when someone already holds the right door she may come to the LEFT one instead.`,
      `${H('Double trouble')} (aggression ${C.bonnie.partnerMinAI}+): Bonnie or Chica may join whoever is already at the right door. Two at one door take twice as long to give up - keep it shut.`,
    ].join('\n\n'),
  },
  {
    title: 'Freddy',
    body: [
      'The brown bear. Slow, patient, and comes to the RIGHT door corner through dark rooms.',
      `${H('Rules')}: he never moves while the camera you are watching shows him. If you ignore him, he gets bolder (+1 aggression for every ${sec(C.freddy.ignoreBonusEvery)} unwatched, up to +${C.freddy.ignoreBonusMax}); looking at him calms him down. A deep laugh means he moved closer.`,
      `${H('At the right corner')} (glowing eyes in the right window):\n• Close the right door for ${sec(C.freddy.repelTicks)} and he leaves.\n• Do NOT use the cameras with the right door open while he is there: after ${sec(C.freddy.slipTicks)} he slips into the office and attacks as soon as you lower the monitor.\n• Leave the door open and he attacks after ${range(C.freddy.patience, 1, 20)}.`,
      `${H('Power out')} (nights 1-3): when the power runs out, Freddy plays a music box at the left door, then everything goes dark, then he attacks - unless 6 AM comes first.`,
    ].join('\n\n'),
  },
  {
    title: 'Fredbear',
    body: [
      `${H('The golden bear')}. Nights 1-3 you may only glimpse him on camera. From night 4 he hunts you: night 4 only through the floor HATCH; nights 5-7 and 9 through the left door, the right door or the hatch. On nights 7 and 9 he is everywhere: he blinks from room to room all over the pizzeria, even onto the main stage, between attempts.`,
      `${H('Early warnings')}: a laugh from somewhere below every time he starts coming for you, and the office lamp flickers while he is right next to the office (faster while he climbs or walks into an entry) - a few seconds before the music box.`,
      `${H('Warning')}: a music box and a golden glow at the entry he chose. You then have ${range(C.fredbear.w1, 5, 20)} to CLOSE THAT ENTRY.`,
      `${H('Counter')}: entry closed + STROBE = he is repelled back to the diner. If the entry stays closed but you do not strobe, he pounds on it for ${range(C.fredbear.w2, 5, 20)}. The FIRST time at each door and at the hatch it holds: he bows and leaves. After that (and always in the Golden Hour) he forces it open (JAMMED): you get one last ${sec(C.fredbear.w3)} to strobe him. He never gets through a closed entry without forcing it first.`,
      `${H('Power out')} (nights 4-7): his golden eyes appear in the dark left doorway with his music box, then darkness, then he attacks - unless 6 AM comes first. The reserve lever still comes first.`,
      `${H('His powers')} (night 4 only the first):\n• Camera disruption: static on every feed for ${sec(FP.disrupt.duration[1])}-${sec(FP.disrupt.duration[3])}.\n• False camera: a purple ECHO of him appears on a camera where he is not, for ${sec(FP.false_cam.duration[2])}.\n• Blackout: an electrical whine, then the office lights and monitor fail for ${sec(FP.blackout.duration[2])}-${sec(FP.blackout.duration[3])}. Doors still work, and the warning windows (Bonnie, Chica, Freddy at the corner, Fredbear's music box) pause until the lights return.\n• Teleport: a chime, a golden shimmer and static on the destination camera warn you ${sec(C.fredbear.relocateWarn)} before he appears somewhere else.`,
      `${H('Mercy')}: after ${N[4].fredbear.maxAttempts} / ${N[5].fredbear.maxAttempts} / ${N[6].fredbear.maxAttempts} / ${N[7].fredbear.maxAttempts} / ${N[9].fredbear.maxAttempts} attempts (nights 4 / 5 / 6 / 7 / 9; repelled or held) he stays in the diner for the rest of the night.`,
      `${H('Night 6 - The Golden Hour')}: at 5 AM the other three go back to the stage and Fredbear rises again with ${N[6].fredbear.finale.extraAttempts} more attempts; you get ${N[6].fredbear.finale.extraCharges} extra strobe charges.`,
    ].join('\n\n'),
  },
  {
    title: 'Morgrave',
    body: [
      `${H('The rabbit in the walls')} (night 8 after you SEALED the building, and night 9). Fredbear's partner from the 1983 diner. He never walks the halls: he crawls.`,
      `${H('Routes')}: out of the supply-closet grate, through the duct (CAM 18) and out of the vent at the LEFT door; or through the old crawlspace below the office (CAM 17) and up under the HATCH.`,
      `${H('Warning')}: scraping inside the walls when he comes out (the caption names the route), vent clanks as he crawls, never footsteps. At the door or hatch he waits only ${range(C.morgrave.telegraph, 8, 20)}.`,
      `${H('Counter')}: seal the duct or the shaft in front of him (he gives up after ${sec(C.morgrave.sealGiveUp)}), or close the left door / the hatch for ${sec(C.morgrave.repelTicks)}. Listen: he is quiet, and his warning window is short.`,
    ].join('\n\n'),
  },
  {
    title: 'Valek',
    body: [
      `${H('The gray bear')} (night 8 after you BURNED the building, and night 9). Nobody remembers ordering him. On the hunt you only ever see his two small eyes.`,
      `${H('Rules')}: he never walks. He steps from one dark spot to the next down the West or East Hall - only while you are not watching the spot he stands on.`,
      `${H('He lies')}: half of his steps play another animatronic's sound on the OTHER side of the building, and the caption believes it. His only honest sound is a faint hum in the corner, and not every time.`,
      `${H('At the corner')} (eyes in the dark window): LIGHT him and he vanishes at once - but he comes back angrier and closer. Hold the door shut for ${sec(C.valek.repelTicks)} and he backs off, calmer. Leave the corner dark and open and he attacks after ${range(C.valek.telegraph, 8, 20)} (shorter when angry).`,
    ].join('\n\n'),
  },
  {
    title: 'Sounds to listen for',
    body: [
      '• Metallic footsteps (side shown in captions): someone is walking near the office.',
      '• Groan at the left: Bonnie in the corner. Vent clank: Bonnie in the vent.',
      '• Pots and pans: Chica in the kitchen. Breathing at the right: Chica at the door.',
      '• Deep laughter (east side): Freddy moved closer.',
      '• Laughter from below: Fredbear has started coming for you.',
      '• The office lamp flickering: Fredbear is right next to the office.',
      '• Music box at an entry: Fredbear is there - close it, then strobe.',
      '• Music box at the left door with no power: Freddy (nights 1-3) or Fredbear (nights 4-7), power out.',
      '• A low electrical hum: the camera monitor is up.',
      '• Chime and shimmer: Fredbear is about to teleport.',
      '• Electrical whine: a blackout in 2 seconds. Glitch: camera disruption.',
      '• Door bangs: something is pounding on a closed entry (or just left). Bonnie banging on the left door can be a distraction for Chica on the right.',
      '• Scraping inside the walls: Morgrave came out (the caption names the route).',
      '• A faint hum in a dark corner: Valek. Any other sound might be him too.',
    ].join('\n'),
  },
  {
    title: 'The nine nights',
    body: [
      ...nightLines,
      `${H('Night 4, the first time')}: before the shift starts you see a memory of 1983 (sneak to skip it).`,
      `${H('After night 7')}: you decide what happens to the building - seal it forever or burn it down. Each choice has its own ending; the Archive shows which ones you have seen. Your choice decides who is waiting on night 8.`,
      `${H('Night 9')}: whatever you chose, all three come for you. There is no night music; the trio sit switched off in Parts & Service. It is meant to be very hard.`,
      `${H('From night 7')} (and in the challenges) the trio look withered: torn suits and missing face plates.`,
    ].join('\n\n'),
  },
  {
    title: 'Challenges',
    body: [
      'Unlocked after beating night 6: press CHALLENGES at the time clock. Each one is a full 12-6 AM night that takes something away and gives something back. A lamp above the button lights up for each one you beat.',
      ...Object.values(CONFIG.challenges).map((c) => `${H(c.title)}: ${c.text}`),
    ].join('\n\n'),
  },
  {
    title: 'Lobby, free roam and settings',
    body: [
      `${H('Time clock')}: choose any unlocked night, the TRAINING SHIFT (a safe practice night), CONTINUE, or FREE ROAM.`,
      `${H('Free roam')}: explore the whole building safely - no animatronic moves. 12 secrets are hidden around the map; ARCHIVE & CREDITS lists the ones you found.`,
      `${H('Settings')}: captions for every sound cue, hints, a fixed seed (the same night plays out the same way every time), a developer overlay, night music on/off and holiday decorations on/off.`,
      `${H('The 1987 tapes')}: once night 5 is behind you, the TAPE DECK in the office (outside nights) plays the security tapes of the night the 1987 guard vanished. Sneak to stop.`,
      `${H('Newspaper clippings')}: the board on the north wall of the time-clock room. One of ${CLIPPINGS.length} clippings unlocks for every night you survive; press READ CLIPPINGS to read them. Together they tell what happened in 1983.`,
      `${H('Holidays')}: around Halloween (Oct 15 - Nov 2) and Christmas (Dec 10 - Jan 6, by your device's date) the pizzeria decorates itself: jack o'lanterns and cobwebs, or Christmas trees and string lights.`,
      `${H('Leaving mid-night')}: if you quit during a night, the night is abandoned and you return to the time clock next time. Unlocked nights and secrets are kept.`,
    ].join('\n\n'),
  },
]);
