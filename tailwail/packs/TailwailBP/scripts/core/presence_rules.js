// What Tailwail does when it is NOT hunting you: the presence events that fill the time
// between encounters.  Pure: no Minecraft imports.
//
// Each event unlocks at an escalation stage, has its own cooldown (in eligible seconds)
// and may need something in the world (torches nearby, a door, a setting switched on).

export const PRESENCE_EVENTS = {
  footsteps: { stage: 0, weight: 3, cooldown: 90, caption: "Footsteps behind you that stop when you stop" },
  mimic: { stage: 0, weight: 3, cooldown: 110, caption: "Your own sounds, repeated in the dark" },
  knock: { stage: 0, weight: 1.4, cooldown: 140, needs: "wall", caption: "Three knocks" },
  glimpse: { stage: 1, weight: 2.2, cooldown: 180, caption: "A shape at the edge of the light" },
  breath: { stage: 1, weight: 2, cooldown: 150, caption: "Breathing right behind you" },
  snuff: { stage: 1, weight: 2, cooldown: 120, needs: "torch", setting: "torchSnuff", caption: "A torch goes out" },
  peek: { stage: 1, weight: 1.6, cooldown: 200, caption: "Something peeks around a corner" },
  door: { stage: 1, weight: 1, cooldown: 300, needs: "door", caption: "A door opens on its own" },
  whisper: { stage: 2, weight: 1.6, cooldown: 240, caption: "Your name, whispered" },
  lights_out: { stage: 2, weight: 1.1, cooldown: 420, needs: "torches", setting: "torchSnuff", caption: "The torches go out, one by one" },
  behind: { stage: 2, weight: 1.1, cooldown: 420, setting: "jumpscares", caption: "Don't turn around" },
  fake_chat: { stage: 2, weight: 0.5, cooldown: 1200, setting: "fakeChat", caption: "Someone joined" },
  // v3
  scrape: { stage: 0, weight: 1.3, cooldown: 150, needs: "wall", caption: "Claws scraping inside the stone" },
  run_steps: { stage: 1, weight: 1.8, cooldown: 220, caption: "Something runs at you from behind, and stops" },
  distant_scream: { stage: 1, weight: 1.3, cooldown: 300, caption: "A scream, far away" },
  runner: { stage: 1, weight: 1.5, cooldown: 260, caption: "Something huge runs across the dark" },
  door_bang: { stage: 1, weight: 1.6, cooldown: 300, needs: "door", caption: "Something hammers on your door" },
  window: { stage: 2, weight: 1.5, cooldown: 360, needs: "window", setting: "jumpscares", caption: "A face at the window" },
};

export const PRESENCE_IDS = Object.keys(PRESENCE_EVENTS);

/**
 * @param {number} stage escalation stage 0..3
 * @param {number} clock eligible seconds now (schedule.eligibleS)
 * @param {Record<string, number>} last  id -> clock value when it last happened
 * @param {{wall?:boolean, torch?:boolean, torches?:boolean, door?:boolean}} env
 * @param {object} settings world settings
 * @param {{weighted:Function}} rng
 * @param {string|null} previous the last event this player got (never repeated back-to-back)
 */
export function pickPresence(stage, clock, last, env, settings, rng, previous = null) {
  const options = [];
  for (const id of PRESENCE_IDS) {
    const e = PRESENCE_EVENTS[id];
    if (e.stage > stage) continue;
    if (id === previous) continue;
    if (e.setting && !settings[e.setting]) continue;
    if (e.needs && !env[e.needs]) continue;
    const at = last[id];
    if (at !== undefined && clock - at < e.cooldown) continue;
    // later stages lean on the stronger events
    const w = e.weight * (stage >= 2 && e.stage >= 1 ? 1.3 : 1);
    options.push([id, w]);
  }
  if (!options.length) return null;
  return rng.weighted(options);
}

/** Vanilla sound ids for the player actions Tailwail repeats back. */
export function mimicSoundFor(action, blockId = "") {
  const id = blockId.replace("minecraft:", "");
  const material = /log|plank|wood|door|chest|barrel|crafting|bookshelf|fence|ladder|sign/.test(id) ? "wood"
    : /gravel/.test(id) ? "gravel"
      : /sand|concrete_powder/.test(id) ? "sand"
        : /dirt|grass|mud|clay|farmland|moss|podzol|mycelium/.test(id) ? "grass"
          : /deepslate|tuff/.test(id) ? "deepslate"
            : /wool|carpet/.test(id) ? "cloth"
              : "stone";
  switch (action) {
    case "break": return { sound: `dig.${material}`, pitch: 0.8 };
    case "place": return { sound: `use.${material}`, pitch: 0.8 };
    case "door": return { sound: "random.door_open", pitch: 0.85 };
    case "door_close": return { sound: "random.door_close", pitch: 0.85 };
    case "chest": return { sound: "random.chestopen", pitch: 0.8 };
    case "eat": return { sound: "random.eat", pitch: 0.75 };
    case "drink": return { sound: "random.drink", pitch: 0.75 };
    case "bow": return { sound: "random.bow", pitch: 0.8 };
    case "hurt": return { sound: "game.player.hurt", pitch: 0.75 };
    case "step": return { sound: `step.${material}`, pitch: 0.75 };
    default: return null;
  }
}
