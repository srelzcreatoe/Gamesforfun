// @ts-nocheck
// =============================================================================
//  THE WHEEL  -  the item you arrive with (and get back every time you die).
//  Use it to choose how he behaves, to see what he thinks of you, and to make
//  him do any one of the things he can do, on the spot.
// =============================================================================
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { cfg, setCfg, resetCfg, PACE_NAMES, AGGRO_NAMES } from "./config.js";

export const WHEEL = "goatwalker:config_wheel";

/** everything he can do, grouped the way he escalates.  [key, name, what you will see, what it needs] */
export const TESTS = {
  "Signs: you never see him": [
    ["bell", "A bell in the trees", "A goat bell, somewhere out there.", ""],
    ["hooves", "Hooves", "Hoofbeats circle you.", ""],
    ["gouge", "Fresh gouges", "A trunk near you is clawed open.", "trees"],
    ["scream", "A scream, far off", "Someone screams. It is not close.", ""],
    ["knock", "Knocking on wood", "Three knocks from the trees.", ""],
    ["snuff", "He snuffs a torch", "A torch near you goes out.", "a torch nearby"],
    ["ash", "A trail of ash", "Hoofprints in ash, leading somewhere.", ""],
    ["shift", "Something has moved", "The place is not how you left it.", ""],
    ["flock", "The flock turns", "Every animal near you turns to look at you.", "animals nearby"],
    ["eyes", "Eyes in the dark", "Red eyes at the edge of the fog. They blink.", "darkness"],
    ["glimpse", "At the edge of your eye", "Him, at the very edge of the screen. Look, and he was never there.", ""],
    ["mimic", "Sounds that should not be there", "Running behind you. Breath at your ear. Humming.", ""],
    ["meta", "The fourth wall", "The game itself notices him.", "fourth-wall scares on"],
  ],
  "He watches": [
    ["watch", "He watches", "He stands a way off and looks at you.", ""],
    ["perch", "He watches from above", "He is up on something, looking down.", "something to stand on"],
    ["daywatch", "A figure in the fog", "By day, deep in the fog.", ""],
    ["treeline", "He walks the treeline", "He walks past, along the edge of the trees.", ""],
    ["gnaw", "He gnaws a tree", "His back to you, eating bark.", "trees"],
    ["cave", "He watches underground", "At the end of the tunnel.", "being underground"],
    ["route", "He waits on your path", "Where you usually walk.", "a path you have used"],
  ],
  "He comes close": [
    ["peek", "He peeks round a trunk", "Half of his face, round a tree.", "trees"],
    ["follow", "He follows you", "He keeps pace behind you.", ""],
    ["breath", "Breath behind a tree", "You see his breath before you see him.", "trees"],
    ["behind", "He is behind you", "He is standing right behind you. Turn round.", ""],
    ["roof", "Hooves on the roof", "He walks across your roof.", "being indoors"],
    ["door", "He is at your door", "He comes to where you sleep.", "being at home, at night"],
  ],
  "He confronts you": [
    ["stalk", "He stalks you", "He closes in from tree to tree.", ""],
    ["standoff", "He shows himself", "He steps out, roars, and moves when you look away.", ""],
    ["many", "There are three of him", "They only move when you are not looking.", ""],
    ["siege", "He besieges you", "He waits outside the room you are in.", "being in a closed room"],
    ["ambush", "He ambushes your escape", "He is waiting where you always run to.", "an escape he has learned"],
  ],
  "He attacks": [
    ["jumpscare", "His face", "What you see when he gets you.", ""],
    ["charge", "He charges", "He screams and comes straight at you, on all fours.", ""],
    ["pursuit", "A short pursuit", "He chases you for half a minute.", ""],
    ["tooslow", "TOO SLOW: the chase you cannot win", "He walks. Then he runs. He is already ahead of you.", ""],
    ["hunt", "The Hunt", "The real thing. Run, hide, or fight.", ""],
    ["after", "Afterwards", "What he leaves where you hid.", ""],
  ],
};
export const SOUNDS = [
  ["m:goatwalker.music.hollow", "Music: The Hollow"], ["m:goatwalker.music.lullaby", "Music: Wind-Down (music box)"],
  ["m:goatwalker.music.static", "Music: Dead Channel"], ["m:goatwalker.music.procession", "Music: Procession"],
  ["m:goatwalker.music.needlefall", "Music: Needlefall"], ["m:goatwalker.music.wrath", "Music: Wrath"],
  ["m:goatwalker.music.tooslow", "Music: Too Slow (chase)"], ["m:goatwalker.music.scapegoat", "Music: Scapegoat (hunt)"],
  ["m:goatwalker.music.eclipse", "Music: Eclipse"], ["m:", "Stop the music"],
  ["goatwalker.laugh", "His laugh"], ["goatwalker.laugh.far", "His laugh, far off"], ["goatwalker.whisper", "A whisper"],
  ["goatwalker.hum", "Humming"], ["goatwalker.ear", "Breath at your ear"], ["goatwalker.roar", "His roar"],
  ["goatwalker.scream", "His scream"], ["goatwalker.growl", "His growl"], ["goatwalker.appear", "He is there"],
  ["goatwalker.glitch", "Glitch"], ["goatwalker.chains", "Chains"], ["goatwalker.groan", "A groan under the ground"],
  ["goatwalker.running", "Running, behind you"], ["goatwalker.bell.far", "The bell"],
];

const show = (form, p) => form.show(p).catch(() => undefined);

/**
 * @param {import("@minecraft/server").Player} p
 * @param {{status:(p:any)=>string, mind:(p:any)=>string, test:(p:any,key:string)=>boolean, mood:(p:any,level:number)=>void,
 *          toWoods:(p:any)=>void, sound:(p:any,id:string)=>void, applied:(p:any)=>void}} api
 */
export async function openWheel(p, api) {
  const f = new ActionFormData().title("§l§4The Wheel")
    .body(`${api.status(p)}\n\n§7Choose.`)
    .button("§lMake him do something§r\n§8Try anything he can do")
    .button("§lSettings§r\n§8How he behaves")
    .button("§lHis mood§r\n§8Calm him, anger him, see what he knows")
    .button("§lSounds and music§r\n§8Hear any of it")
    .button("§lTake me to his woods§r\n§8The edge of the nearest Stellar Taiga")
    .button("§lWhat is all this?§r\n§8How he works");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  if (r.selection === 0) return testMenu(p, api);
  if (r.selection === 1) return settings(p, api);
  if (r.selection === 2) return mood(p, api);
  if (r.selection === 3) return sounds(p, api);
  if (r.selection === 4) return api.toWoods(p);
  return help(p, api);
}

async function testMenu(p, api) {
  const groups = Object.keys(TESTS);
  const f = new ActionFormData().title("§lMake him do something")
    .body("§7He does it now, to you, wherever you are standing. Some things need a place (trees, a roof over you, the dark): you are told if this is not it.\n\n§8Everything here also happens by itself.");
  for (const g of groups) f.button(`§l${g}§r\n§8${TESTS[g].length} things`);
  f.button("§8Back");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  if (r.selection >= groups.length) return openWheel(p, api);
  const list = TESTS[groups[r.selection]];
  const g = new ActionFormData().title(`§l${groups[r.selection]}`).body("§7Pick one.");
  for (const [, name, what, needs] of list) g.button(`§l${name}§r\n§8${needs ? `needs ${needs}` : what}`.slice(0, 90));
  g.button("§8Back");
  const q = await show(g, p);
  if (!q || q.canceled) return;
  if (q.selection >= list.length) return testMenu(p, api);
  const [key, name, what, needs] = list[q.selection];
  if (api.test(p, key)) p.sendMessage(`§8[The Wheel]§7 ${name}. §8${what}`);
  else p.sendMessage(`§8[The Wheel]§c ${name}: not here.§7 ${needs ? `It needs ${needs}, and somewhere for him to stand that you are not looking at.` : "There is no room for it where you are standing. Try open ground."}`);
}

async function settings(p, api) {
  const c = cfg();
  const f = new ModalFormData().title("§lSettings")
    .dropdown("How often things happen", PACE_NAMES, { defaultValueIndex: c.pace })
    .dropdown("How quickly he gets angry, and how readily he attacks", AGGRO_NAMES, { defaultValueIndex: c.aggro })
    .toggle("He can hurt you (off: every scare, but no damage and no hunts)", { defaultValue: c.harm })
    .toggle("The chase you cannot outrun (Too Slow)", { defaultValue: c.chase })
    .toggle("Fourth-wall scares (fake chat lines, words on your screen)", { defaultValue: c.meta })
    .toggle("Jumpscares (his face, when he gets you)", { defaultValue: c.jumpscare })
    .toggle("Eyes in the dark", { defaultValue: c.eyes })
    .toggle("He is active by day too", { defaultValue: c.day })
    .toggle("He damages things (snuffs torches, rams doors)", { defaultValue: c.grief })
    .toggle("Camera shake", { defaultValue: c.shake })
    .toggle("Give me The Wheel when I arrive and each time I die", { defaultValue: c.wheel })
    .toggle("New worlds start at the edge of his woods", { defaultValue: c.spawn })
    .toggle("§cPut every setting back to normal", { defaultValue: false })
    .submitButton("Save");
  const r = await show(f, p);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  if (v[12] === true) resetCfg();
  else setCfg({ pace: Number(v[0]), aggro: Number(v[1]), harm: !!v[2], chase: !!v[3], meta: !!v[4], jumpscare: !!v[5], eyes: !!v[6], day: !!v[7],
    grief: !!v[8], shake: !!v[9], wheel: !!v[10], spawn: !!v[11] });
  api.applied(p);
  const n = cfg();
  p.sendMessage(`§8[The Wheel]§7 Saved. Pace: §f${PACE_NAMES[n.pace]}§7. He is: §f${AGGRO_NAMES[n.aggro]}§7.${n.harm ? "" : " §fHe cannot hurt you."}`);
}

async function mood(p, api) {
  const f = new ActionFormData().title("§lHis mood")
    .body(`${api.status(p)}\n\n§7What he has learned about you:\n§8${api.mind(p)}`)
    .button("§lCalm him§r\n§8He forgets his anger")
    .button("§lHe notices you§r\n§8Watching")
    .button("§lHe stalks you§r\n§8Stalking")
    .button("§l§cMake him wrathful§r\n§8He stops watching and starts attacking")
    .button("§l§4HE IS COMING§r\n§8As angry as he gets")
    .button("§8Back");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  if (r.selection >= 5) return openWheel(p, api);
  api.mood(p, r.selection);
}

async function sounds(p, api) {
  const f = new ActionFormData().title("§lSounds and music").body("§7Played to you only.");
  for (const [, name] of SOUNDS) f.button(name);
  f.button("§8Back");
  const r = await show(f, p);
  if (!r || r.canceled) return;
  if (r.selection >= SOUNDS.length) return openWheel(p, api);
  api.sound(p, SOUNDS[r.selection][0]);
  return sounds(p, api);
}

async function help(p, api) {
  const f = new ActionFormData().title("§lHow he works").body([
    "§fHe lives in the Stellar Taiga§7 and he does not like you in it. The longer you stay, and the more of his you break or take, the angrier he gets.",
    "§fHis wrath has five stages§7, and you are told when it changes: unaware, watching, stalking, wrathful, hunting.",
    "§7While he is only §fwatching§7, walk up to him and he is gone, and then he is behind you. Once he is §fwrathful§7, walk up to him and he comes for you.",
    "§fWhat calms him:§7 leaving his woods, the dawn, an offering of raw mutton on a tree, surviving a hunt.",
    "§fWhat angers him:§7 the night in his woods, felling his trees, taking his skulls, breaking his effigies, blowing a goat horn, smoke, rushing at him.",
    "§fYou cannot outrun him.§7 In a hunt he is faster than you can sprint: break his sight of you, hide, light, water, fight.",
    "§fToo Slow:§7 he walks, then he drops to all fours and comes flat out. Stop. Turn round. Look at him.",
    "§fThe Hunt:§7 when his candles burn down, or when his anger is full. Run, hide, or fight: he learns which you do.",
    "§8Everything is on The Wheel under 'Make him do something'.",
  ].join("\n\n")).button("Back");
  const r = await show(f, p);
  if (r && !r.canceled) return openWheel(p, api);
}
