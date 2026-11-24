#!/usr/bin/env python3
"""Merge the user's three dwellers — The Goatwalker 3.1, the Brinesleeper 7.0 and the Shaftbreaker 3.1 — into The
Observer's packs (1.6.0). Their archives are kept unmodified in source_assets/supplied_dwellers/ (SHA256SUMS.txt).

What happens to each file of their packs:
  * scripts/**            copied to packs/TheObserver_BP/scripts/dwellers/<name>/**, with a short, fixed list of patches
                          (PATCHES below; each must match exactly as written, or the merge stops):
                            - every `world.getAllPlayers()` becomes `__dw.players("<name>")`: a dweller switched off on
                              the Config Wheel sees nobody, and none of them see anyone in the Rift;
                            - their music goes through one shared channel (scripts/link/shared.js) instead of each
                              calling playMusic/stopMusic on its own;
                            - they no longer hand out their own settings wheels unasked (the Config Wheel opens them);
                            - a few exports the Observer needs (their settings, switching off, being sent after someone);
                            - `// @ts-nocheck` (their code keeps its own conventions; the Observer's is type-checked).
  * manifest.json, pack_icon.png, README.txt, texts/languages.json — not copied (one pack now).
  * blocks.json, sounds.json, sounds/sound_definitions.json, sounds/music_definitions.json, textures/terrain_texture.json,
    textures/item_texture.json, textures/flipbook_textures.json, texts/en_US.lang — merged entry by entry; an entry two
    packs define differently stops the merge.
  * three files share a path with another pack's and are renamed (RENAME); their identifiers are already distinct.
  * everything else — biomes, blocks, entities, items, features, structures, loot, recipes, models, textures, sounds,
    particles, fogs, the Goatwalker's lighting and colour grading — copied as it is.
  * the biomes' replace_biomes rules are tuned so the Stellar Taiga, the Weeping Mire and the Hollows each keep land of
    their own and do not run into one another, and each dweller has 500 health (JSON_TUNING).

Usage: python3 tools/merge_dwellers.py           merge (safe to re-run: it rewrites everything it owns)
       python3 tools/merge_dwellers.py --check   verify the packs hold exactly what the merge would write
"""
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
SRC = os.path.join(ROOT, "source_assets", "supplied_dwellers")

DWELLERS = [
    ("goatwalker", "The_Goatwalker_v3.1.mcaddon", "Goatwalker_BP", "Goatwalker_RP"),
    ("brinesleeper", "Brinesleeper.mcaddon", "Brinesleeper_BP", "Brinesleeper_RP"),
    ("shaftbreaker", "Shaftbreaker.mcaddon", "Shaftbreaker_BP", "Shaftbreaker_RP"),
]
SKIP = {"manifest.json", "pack_icon.png", "README.txt", "texts/languages.json"}

# (1.7.0) the Brinesleeper's music and voice made over (tools/synth_dark.py: darker, in the old horror fan-games' vein):
# its sound ids now point at the new files, and its old ones are not copied in
_BV = "sounds/mob/brinesleeper_dark/"
_BM = "sounds/music/brine_dark/"
SOUND_OVERRIDES = {"brinesleeper": {
    "music.brine.stillwater": [_BM + f"stillwater_{i}" for i in (1, 2, 3)],
    "music.brine.near": [_BM + "near_1", _BM + "near_2"],
    "music.brine.chase": [_BM + "chase"],
    "music.brine.sting": [_BM + f"sting_{i}" for i in (1, 2, 3)],
    "brine.spotted": [_BV + "spotted"], "brine.jumpscare": [_BV + "jumpscare"],
    **{f"mob.brinesleeper.{k}": [_BV + k] for k in ("breathe", "call", "death", "emerge", "grasp", "hiss", "hurt", "lunge", "moan", "roar", "submerge")},
    "mob.brinesleeper.click": [_BV + "click1", _BV + "click2"], "mob.brinesleeper.step": [_BV + "step1", _BV + "step2"],
}, "shaftbreaker": {
    # (1.7.0) its music made over darker (tools/synth_dark.py)
    f"music.shaftbreaker.{k}": [f"sounds/music/shaft_dark/{k}"] for k in ("presence", "hollows", "close", "standoff", "chase")
}}
SKIP_FILES = {("brinesleeper", "RP", r) for r in (
    [f"sounds/music/brine/{n}.ogg" for n in ("stillwater_1", "stillwater_2", "stillwater_3", "stillwater_4", "stillwater_5", "near_1", "near_2", "chase", "sting_1", "sting_2", "sting_3")]
    + [f"sounds/mob/brinesleeper/{n}.ogg" for n in ("breathe", "call", "death", "emerge", "grasp", "hiss", "hurt", "lunge", "moan", "roar", "submerge", "click1", "click2", "step1", "step2")]
    + ["sounds/brine_fx/spotted.ogg", "sounds/brine_fx/jumpscare.ogg"])} | {
    ("shaftbreaker", "RP", f"sounds/shaftbreaker/music_{k}.ogg") for k in ("presence", "hollows", "close", "standoff", "chase")}
RENAME = {
    ("goatwalker", "BP", "entities/flare.json"): "entities/gw_flare.json",
    ("goatwalker", "RP", "entity/flare.entity.json"): "entity/gw_flare.entity.json",
    ("brinesleeper", "BP", "items/config_wheel.json"): "items/brine_config_wheel.json",
}
MERGED = {
    "RP": {"blocks.json", "sounds.json", "sounds/sound_definitions.json", "sounds/music_definitions.json",
           "textures/terrain_texture.json", "textures/item_texture.json", "textures/flipbook_textures.json", "texts/en_US.lang"},
    "BP": {"texts/en_US.lang"},
}
LINK = "scripts/link/shared.js"

# The biomes, each on ground of its own (no vanilla biome is claimed by two: where two claim the same one, neither
# appears — measured on a dedicated server, 1.7.0). On the surface: the Goatwalker's Stellar Taiga takes the taigas, the
# oak and flower forests, the groves and meadows (the birch and dark forests and the plains go to the Weeping Mire,
# tools/merge_weeping_mire.py, with the swamps, rivers, jungles, deserts and gardens). Underground (1.7.0): the
# Shaftbreaker's Hollows is a cave biome now — it takes the dripstone caves, and paints its walls with veinstone, flesh and
# bone; the Brinesleeper's Stillwater Caves give the dripstone caves up and take three quarters of the lush caves instead
# (a little less of them over a whole map: measured with otest:cavewide over 3 km squares on two seeds).
def _drop_targets(drop):
    def f(d):
        rule = d["minecraft:biome"]["components"]["minecraft:replace_biomes"]["replacements"][0]
        rule["targets"] = [t for t in rule["targets"] if t not in drop]
    return f


HOLLOWS_TARGETS = [{"dimension": "minecraft:overworld", "targets": ["minecraft:dripstone_caves"], "amount": 1.0, "noise_frequency_scale": 0.15}]
STILLWATER_TARGETS = [{"dimension": "minecraft:overworld", "targets": ["minecraft:lush_caves"], "amount": 0.75, "noise_frequency_scale": 0.1}]


def _hollows(d):
    d["format_version"] = "1.26.30"   # (the wall painter, as the Stillwater Caves use it, needs this version)
    c = d["minecraft:biome"]["components"]
    c["minecraft:replace_biomes"] = {"replacements": HOLLOWS_TARGETS}
    c["minecraft:tags"] = {"tags": ["caves", "overworld", "monster", "shaftbreaker_hollows"]}
    # its walls: veinstone, with bands of flesh, cracked veinstone glowing, seams of bone, a little deepslate
    c["minecraft:subsurface_builder"] = {"builder": {
        "type": "minecraft:noise_gradient",
        "noise_descriptor": {"name": "shaftbreaker:hollow_walls", "first_octave": -5, "amplitudes": [1.0, 0.6, 0.3]},
        "non_replaceable_blocks": ["minecraft:bedrock"],
        "noise_block_specifiers": [
            {"range": {"min": -1.0, "max": -0.45}, "block": "minecraft:deepslate"},
            {"range": {"min": -0.45, "max": -0.1}, "block": "shaftbreaker:veinstone"},
            {"range": {"min": -0.1, "max": 0.02}, "block": "shaftbreaker:fleshstone"},
            {"range": {"min": 0.02, "max": 0.3}, "block": "shaftbreaker:veinstone"},
            {"range": {"min": 0.3, "max": 0.36}, "block": "shaftbreaker:cracked_veinstone"},
            {"range": {"min": 0.36, "max": 0.52}, "block": "shaftbreaker:veinstone"},
            {"range": {"min": 0.52, "max": 0.6}, "block": "shaftbreaker:ribstone"},
            {"range": {"min": 0.6, "max": 0.72}, "block": "shaftbreaker:fleshstone"},
            {"range": {"min": 0.72, "max": 1.0}, "block": "shaftbreaker:veinstone"}]}}
    c.setdefault("minecraft:overworld_height", {"noise_type": "default"})


def _stillwater(d):
    d["minecraft:biome"]["components"]["minecraft:replace_biomes"] = {"replacements": STILLWATER_TARGETS}


def _health(n, extra=None):
    """Every health component of an entity set to n (its threat groups too), then anything else it needs."""
    def f(d):
        e = d["minecraft:entity"]

        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k == "minecraft:health" and isinstance(v, dict):
                        v["value"] = n
                        v["max"] = n
                    else:
                        walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(e)
        if extra:
            extra(e)
    return f


def _shaft_defeat(e):
    """Its defeat comes at a fifth of its health, as before (22 of 112 then; 98 of 500 now)."""
    hits = 0

    def walk(o):
        nonlocal hits
        if isinstance(o, dict):
            if o.get("test") == "actor_health" and o.get("value") == 22:
                o["value"] = 98
                hits += 1
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(e)
    if hits != 1:
        sys.exit(f"the Shaftbreaker's defeat threshold: {hits} found, 1 expected")


def _denser(times=1, scatter=None):
    """A feature rule placed more often: iterations × times, and/or a scatter chance of 1 in `scatter`."""
    def f(d):
        dist = d["minecraft:feature_rules"]["distribution"]
        dist["iterations"] = int(dist.get("iterations", 1)) * times
        if scatter:
            dist["scatter_chance"] = {"numerator": 1, "denominator": scatter}
    return f


# (1.7.0) the Hollows fouler: its flesh, organs, vines, fangs, pods, thorns and the dead far more often
_HOLLOWS_DENSER = {
    "inf_bloodmoss_rule": _denser(3), "inf_vines_rule": _denser(3), "inf_vines_tip_rule": _denser(3), "inf_fang_rule": _denser(3),
    "inf_glowspore_rule": _denser(2), "inf_thorns_rule": _denser(3), "inf_organ_floor_rule": _denser(3), "inf_pod_floor_rule": _denser(3),
    "inf_pulsing_rule": _denser(3), "inf_fleshstone_rule": _denser(2), "inf_cracked_rule": _denser(2), "inf_ribseam_rule": _denser(2),
    "inf_organ_chamber_rule": _denser(1, 2), "inf_organ_mound_rule": _denser(1, 3), "inf_watcher_nest_rule": _denser(1, 2),
    "inf_rib_arch_1_rule": _denser(1, 3), "inf_rib_arch_2_rule": _denser(1, 3), "inf_skeleton_1_rule": _denser(1, 2),
    "inf_skeleton_2_rule": _denser(1, 2), "inf_mine_support_1_rule": _denser(1, 3), "inf_mine_support_2_rule": _denser(1, 3),
}

# (dweller, path in its pack) -> a function that changes the parsed JSON (1.7.0; the Stellar Taiga's since 1.6.0)
JSON_TUNING = {
    **{("shaftbreaker", f"feature_rules/infected/{k}.json"): fn for k, fn in _HOLLOWS_DENSER.items()},
    ("goatwalker", "biomes/stellar_taiga.biome.json"): _drop_targets(["minecraft:plains", "minecraft:sunflower_plains", "minecraft:birch_forest",
        "minecraft:birch_forest_hills", "minecraft:birch_forest_mutated", "minecraft:birch_forest_hills_mutated",
        "minecraft:roofed_forest", "minecraft:roofed_forest_mutated"]),
    ("shaftbreaker", "biomes/the_hollows.biome.json"): _hollows,
    # (1.7.0) underground now: its mist the deep red of its infested caves
    ("shaftbreaker", "biomes/the_hollows.client_biome.json"): lambda d: d["minecraft:client_biome"]["components"]["minecraft:fog_appearance"].update(
        {"fog_identifier": "shaftbreaker:fog_infected"}),
    ("brinesleeper", "biomes/stillwater_caves.biome.json"): _stillwater,
    # each of them 500 health (1.7.0)
    ("goatwalker", "entities/goatwalker.json"): _health(500),
    ("brinesleeper", "entities/brinesleeper.json"): _health(500),
    ("shaftbreaker", "entities/shaftbreaker.json"): _health(500, _shaft_defeat),
}

# (dweller, file under scripts/, old, new) — each old must occur exactly once in the original
PATCHES = [
    # --- The Goatwalker
    ("goatwalker", "config.js",
     "  wheel: true,      // give The Wheel when you arrive and every time you die",
     "  wheel: false,     // give The Wheel when you arrive and every time you die (merged into The Observer: off; its Config Wheel opens his)"),
    ("goatwalker", "core.js",
     "  if (!track) safe(() => p.stopMusic());\n  else safe(() => p.playMusic(track, { loop: true, fade: 2.0, volume: 1.0 }));",
     "  if (!track) safe(() => __dw.musicStop(\"goatwalker\", p));\n  else safe(() => __dw.musicPlay(\"goatwalker\", p, track, { loop: true, fade: 2.0, volume: 1.0 }));"),
    ("goatwalker", "main.js",
     "      safe(() => p.stopMusic());",
     "      safe(() => __dw.musicStop(\"goatwalker\", p));"),
    ("goatwalker", "main.js",
     "      if (track) safe(() => p.playMusic(track, { fade: 0.5, volume: 1.0, loop: false }));",
     "      if (track) safe(() => __dw.musicPlay(\"goatwalker\", p, track, { fade: 0.5, volume: 1.0, loop: false }));"),
    ("goatwalker", "main.js", "const WHEEL_API = {", "export const WHEEL_API = {"),
    # (1.7.0: 500 health — he still gives up a chase at about a third of it)
    ("goatwalker", "hunt.js",
     "    const hp = safe(() => w.e.getComponent(\"minecraft:health\").currentValue, 80);\n    if (hp < 26 && this.state === \"chase\") {",
     "    const hp = safe(() => w.e.getComponent(\"minecraft:health\").currentValue, 500);\n    if (hp < 162 && this.state === \"chase\") {"),
    # --- The Brinesleeper
    ("brinesleeper", "music.js",
     "    const w = config.music ? want(p, t) : 'none';",
     "    const w = config.music && config.enabled ? want(p, t) : 'none';"),
    ("brinesleeper", "music.js",
     "          else if (t >= st.gap) { p.playMusic('music.brine.stillwater', { fade: 3, volume: 0.85 }); st.until = t + CALM_TICKS; st.gap = 0; }",
     "          else if (t >= st.gap) { __dw.musicPlay('brinesleeper', p, 'music.brine.stillwater', { fade: 3, volume: 0.85 }); st.until = t + CALM_TICKS; st.gap = 0; }"),
    ("brinesleeper", "music.js",
     "      if (w === 'chase') p.playMusic('music.brine.chase', { loop: true, fade: 0.4, volume: 0.95 });\n      else if (w === 'near') p.playMusic('music.brine.near', { loop: true, fade: 2.5, volume: 0.9 });",
     "      if (w === 'chase') __dw.musicPlay('brinesleeper', p, 'music.brine.chase', { loop: true, fade: 0.4, volume: 0.95 });\n      else if (w === 'near') __dw.musicPlay('brinesleeper', p, 'music.brine.near', { loop: true, fade: 2.5, volume: 0.9 });"),
    ("brinesleeper", "music.js",
     "        if (st.track === 'none') { p.playMusic('music.brine.stillwater', { fade: 4, volume: 0.85 }); st.until = t + CALM_TICKS; }\n        else { p.stopMusic(); st.until = t;",
     "        if (st.track === 'none') { __dw.musicPlay('brinesleeper', p, 'music.brine.stillwater', { fade: 4, volume: 0.85 }); st.until = t + CALM_TICKS; }\n        else { __dw.musicStop('brinesleeper', p); st.until = t;"),
    ("brinesleeper", "music.js",
     "      } else p.stopMusic();",
     "      } else __dw.musicStop('brinesleeper', p);"),
    # (1.7.0) on high alert. It starts out bold (it no longer has to learn to stand its ground); come close and it stands
    # and stares you down, or it comes for you — it is only now and then simply gone; and in a standoff, more often
    # than not, it attacks
    ("brinesleeper", "brain.js",
     "const PROFILE = { bold: 0.1, looks: 0,",
     "const PROFILE = { bold: 0.45, looks: 0,"),
    ("brinesleeper", "brain.js",
     "  m.seenFor = 0;\n  debug(`brinesleeper: ${state}`);",
     "  m.seenFor = 0;\n  debug(`brinesleeper: ${state}`);\n  __dw.note('brinesleeper', { what: 'state', state });"),
    ("brinesleeper", "brain.js",
     "        if (pr.bold > 0.7 && tooClose && chance(0.4)) {            // it no longer runs from you\n"
     "          if (m.kind === 'water') approach(c, m, target); else standoff(c, m, target);\n"
     "          break;\n"
     "        }",
     "        if (tooClose && hunter(target) && d < 6 && chance(0.6)) { chase(c, m, target); break; }   // (1.7.0) right up to it: it comes\n"
     "        if (tooClose && (pr.bold > 0.35 || chance(0.6))) {        // it no longer runs from you\n"
     "          if (m.kind === 'water') approach(c, m, target); else standoff(c, m, target);\n"
     "          break;\n"
     "        }"),
    ("brinesleeper", "brain.js",
     "      if ((seen && m.seenFor >= 10) || d < 12) { vanish(c, m, target); break; }",
     "      if (d < 6 && hunter(target) && chance(0.6)) { chase(c, m, target); break; }          // (1.7.0)\n"
     "      if ((seen && m.seenFor >= 10) || d < 12) { if (chance(0.55)) { if (inWater(c)) approach(c, m, target); else standoff(c, m, target); } else vanish(c, m, target); break; }"),
    ("brinesleeper", "brain.js",
     "      if (t < m.until) break;\n      if (t < m.cooldownUntil) { lurk(c, m, target, rand(8, 16)); if (chance(0.35)) watch(c, m, target); break; }",
     "      // (1.7.0) come within a few blocks of the water it lies in and it rises for you\n"
     "      if (d < 7 && hunter(target) && t - (m.lastRise ?? -9999) > 20 * TPS) { m.lastRise = t; if (inWater(c)) approach(c, m, target); else standoff(c, m, target); break; }\n"
     "      if (t < m.until) break;\n      if (t < m.cooldownUntil) { lurk(c, m, target, rand(8, 16)); if (chance(0.35)) watch(c, m, target); break; }"),
    ("brinesleeper", "brain.js",
     "  const p = preset().chase + (provoked ? 0.25 : 0) + pr.bold * 0.3 + 0.03 * Math.min(8, pr.fights);\n"
     "  if (hunter(target) && chance(p)) chase(c, m, target);\n"
     "  else { if (pr.bold < 0.5 || chance(0.5)) retreat(c, m, target); else stalk(c, m, target); }",
     "  const p = 0.2 + preset().chase + (provoked ? 0.25 : 0) + pr.bold * 0.3 + 0.03 * Math.min(8, pr.fights);\n"
     "  if (hunter(target) && chance(p)) chase(c, m, target);\n"
     "  else { if (pr.bold < 0.3 && chance(0.5)) retreat(c, m, target); else stalk(c, m, target); }"),
    ("brinesleeper", "brain.js",
     "const gap = () => Math.round(randInt(...preset().stalkGap) * TPS / freq());",
     "const gap = () => Math.round(randInt(...preset().stalkGap) * TPS / (freq() * 1.6));"),
    # (1.7.0) its staged scenes: walk up to it and, more often than not, it turns on you instead of slipping away
    ("brinesleeper", "main.js",
     "    if (d < 9) break;                                        // too close: it sinks without a sound",
     "    if (d < 9) { if (__brineTurns(player)) { yield* __turnOn(c, player, s); return; } break; }   // too close: it sinks without a sound — or turns on you"),
    ("brinesleeper", "main.js",
     "    if (flat(player.location, s) < 10) {                   // it never lets you walk up to it",
     "    if (flat(player.location, s) < 10 && __brineTurns(player)) { yield* __turnOn(c, player, s); return; }\n"
     "    if (flat(player.location, s) < 10) {                   // it never lets you walk up to it"),
    ("brinesleeper", "menu.js",
     "  if (!initialSpawn || !isOp(player) || player.getDynamicProperty('brine:wheel')) return;",
     "  if (!initialSpawn || !isOp(player) || player.getDynamicProperty('brine:wheel') || !__dw.GIVE_OWN_WHEELS) return;"),
    # --- The Shaftbreaker
    # (1.7.0: 500 health — its home heals it, and a broken organ wounds it, in the same proportion as before)
    ("shaftbreaker", "ai/brain.js",
     "h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 2)); });",
     "h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 9)); });"),
    ("shaftbreaker", "ai/director.js",
     "c.e.applyDamage(cracked ? 18 : 10, { cause: /** @type {any} */ ('magic') })",
     "c.e.applyDamage(cracked ? 80 : 45, { cause: /** @type {any} */ ('magic') })"),
    # (1.7.0) it lives in the caves: above ground only once it has followed you up, after you have got away from it three
    # times; then for twelve minutes it is on the surface too (by day or night as its own settings say)
    ("shaftbreaker", "ai/director.js",
     "  s.night = !ug && p.dimension.id === OVERWORLD && (!!cfgN.dayStalking || (!!cfgN.nightStalking && !isDaylight()));",
     "  s.night = !ug && p.dimension.id === OVERWORLD && worldTicks() < (pf.followUntil || 0) && (!!cfgN.dayStalking || (!!cfgN.nightStalking && !isDaylight()));"),
    ("shaftbreaker", "ai/director.js",
     "  if (s.hollows && !ug) s.night = true;",
     "  if (s.hollows && !ug && worldTicks() < (pf.followUntil || 0)) s.night = true;"),
    ("shaftbreaker", "ai/director.js",
     "  if (!cfg.enabled || !cfg.naturalEncounters || p.dimension.id !== OVERWORLD) return false;\n  return now() >= pstate(p).graceUntil;",
     "  if (!cfg.enabled || !cfg.naturalEncounters || p.dimension.id !== OVERWORLD) return false;\n  return now() >= pstate(p).graceUntil && worldTicks() < (profile(p).followUntil || 0);"),
    ("shaftbreaker", "ai/encounters/hunt.js",
     "import { now, sec, valid, sub, len, lenXZ, dist, norm, rand, chance, pick, center, floor3, clamp, safe } from '../../core/util.js';",
     "import { now, sec, mins, worldTicks, valid, sub, len, lenXZ, dist, norm, rand, chance, pick, center, floor3, clamp, safe } from '../../core/util.js';"),
    ("shaftbreaker", "ai/encounters/hunt.js",
     "  if (outcome === 'caught') pf.huntsCaught++;",
     "  if (outcome === 'caught') pf.huntsCaught++;\n"
     "  // (1.7.0) every third time you get away, it follows you up out of the caves for a while\n"
     "  if (escaped) {\n"
     "    pf.escapesSinceFollow = (pf.escapesSinceFollow || 0) + 1;\n"
     "    if (pf.escapesSinceFollow >= 3) { pf.escapesSinceFollow = 0; pf.followUntil = worldTicks() + mins(12); ctx.tel.notes.push('it follows you up'); }\n"
     "  }"),
    # (1.7.0) up close it never just stands there: it tears into you, or with a shriek in your face it is gone; and held
    # in a stare up close, it snaps
    ("shaftbreaker", "ai/brain.js",
     "  const seen = seenByAnyone(c);\n  if (seen) {\n    B.lastSeenTick = now();",
     "  const seen = seenByAnyone(c);\n"
     "  if (seen && d < 12) { if (!B.staredAt) B.staredAt = now(); } else B.staredAt = 0;\n"
     "  const stared = B.staredAt && now() - B.staredAt > sec(3.5);\n"
     "  if ((d < 4.2 || stared) && now() >= (B.closeReactAt || 0)) {\n"
     "    B.closeReactAt = now() + sec(6); B.staredAt = 0;\n"
     "    const s0 = api.pstate(p);\n"
     "    const attack = !config().harmless && api.rage && chance(Math.min(0.9, (stared ? 0.5 : 0.6) + (s0.provocation || 0) / 200 + (s0.state === 'provoked' ? 0.15 : 0)));\n"
     "    c.halt(); c.face(p.getHeadLocation());\n"
     "    __dw.note('shaftbreaker', { what: 'close', how: attack ? 'rage' : 'vanish', why: stared ? 'stare' : 'close', d: Math.round(d * 10) / 10, player: p.name });\n"
     "    if (attack) { api.provoke(p, 20, stared ? 'held its stare' : 'right up against it'); playAt(c.dim, 'shaftbreaker.screech', { x: c.loc.x, y: c.loc.y + 2, z: c.loc.z }, 1, rand(0.8, 0.95)); api.rage(p, stared ? 'stare' : 'too close'); return; }\n"
     "    playAt(c.dim, 'shaftbreaker.jumpscare', { x: c.loc.x, y: c.loc.y + 2, z: c.loc.z }, 1, rand(0.9, 1.05));\n"
     "    setDanger(p, 0.9); c.vanish(false); B.shyUntil = now() + sec(40); return;\n"
     "  }\n"
     "  if (seen) {\n    B.lastSeenTick = now();"),
    ("shaftbreaker", "ai/director.js",
     "initBrain({\n  pstate,\n  running: () => cur,\n  provoke,",
     "initBrain({\n  pstate,\n  running: () => cur,\n  provoke,\n  rage: (p, why) => queueRage(p, why),"),
    # (1.7.0) when it is watching you and you come right up to it, it comes for you more often than not
    ("shaftbreaker", "ai/encounters/common.js",
     "    if (s.dist < 2.4) return 'touched';",
     "    if (s.dist < 3.4) return 'touched';"),
    ("shaftbreaker", "ai/encounters/observe.js",
     "    if (r2 === 'touched' && wantsHunt(ctx, 0.35)) {",
     "    if (r2 === 'touched' && wantsHunt(ctx, 0.65)) {"),
    # (1.7.0) more of its standoffs and hunts in the mix
    ("shaftbreaker", "ai/director.js",
     "const FAMILY_WEIGHT = { stalk: 30, uncanny: 20, audio: 15, env: 15, standoff: 10, hunt: 8, rare: 2 };",
     "const FAMILY_WEIGHT = { stalk: 30, uncanny: 20, audio: 12, env: 12, standoff: 14, hunt: 14, rare: 2 };"),
    ("shaftbreaker", "core/config.js",
     "  giveWheel: true,                    // players get the Breaker's Wheel when they first join and after dying",
     "  giveWheel: false,                   // players get the Breaker's Wheel when they first join and after dying (merged into The Observer: off)"),
    ("shaftbreaker", "audio.js",
     "  try { player.playMusic(track, { fade: 2.0, loop: true, volume: pr.reducedAudio ? vol * 0.55 : vol }); s.music = track; } catch { /* ignore */ }",
     "  try { __dw.musicPlay('shaftbreaker', player, track, { fade: 2.0, loop: true, volume: pr.reducedAudio ? vol * 0.55 : vol }); s.music = track; } catch { /* ignore */ }"),
    ("shaftbreaker", "audio.js",
     "  try { player.stopMusic(); } catch { /* ignore */ }",
     "  try { __dw.musicStop('shaftbreaker', player); } catch { /* ignore */ }"),
]

# A pack may register custom commands under one namespace only, so the dwellers' slash commands move under the
# Observer's (their /scriptevent commands are not custom commands and keep their names):
#   /brine:settings ... /brine:status  ->  /observer:brine_settings ... /observer:brine_status
#   /shaftbreaker:sb                   ->  /observer:sb
# (dweller, file under scripts/, regex, replacement, exact count)
REGEX_PATCHES = [
    ("brinesleeper", "menu.js", r"'brine:encounter_name'", "'observer:brine_encounter_name'", 2),
    ("brinesleeper", "menu.js", r"name: 'brine:(\w+)'", r"name: 'observer:brine_\1'", 7),
    ("brinesleeper", "menu.js", r"/brine:(\w+)", r"/observer:brine_\1", 7),
    ("shaftbreaker", "main.js", r"'shaftbreaker:action'", "'observer:sb_action'", 2),
    ("shaftbreaker", "main.js", r"'shaftbreaker:sb'", "'observer:sb'", 1),
    ("shaftbreaker", "main.js", r"/shaftbreaker:sb", "/observer:sb", 1),
    ("shaftbreaker", "core/config.js", r"/shaftbreaker:sb", "/observer:sb", 1),
]

# appended to a dweller's script: what the Observer calls (switching it off, opening its own settings, sending it)
APPEND = {
    ("brinesleeper", "main.js"): '''
// ---------------------------------------------------------------- merged into The Observer (1.7.0)
/** Walked right up to in one of its scenes: does it turn on them? (more often than not, if they can be hunted) */
function __brineTurns(player) {
  try { const m = player.getGameMode(); if (m !== GameMode.Survival && m !== GameMode.Adventure) return false; } catch (e) { return false; }
  return config.enabled && preset().chase > 0 && Math.random() < 0.6;
}
/** It turns on them: it rises with a roar, and from here its own mind (brain.js) hunts them down. */
function* __turnOn(c, player, s) {
  if (!c.isValid || !player.isValid) return;
  sound(c.dimension, 'mob.brinesleeper.roar', s, 1.2, 0.9);
  sting(player, 0.9);
  press(player.id, 'chase', now() + 60);
  try { player.playSound('brine.spotted', { volume: 1 }); } catch (e) { /* ok */ }
  handoff.set(c.id, { state: 'chase', target: player.id });
  c.removeTag(STAGED);
  if (scene && scene.creature && scene.creature.id === c.id) scene.creature = undefined;
  yield 1;
}
''',
    ("goatwalker", "main.js"): '''
// ---------------------------------------------------------------- merged into The Observer (1.6.0)
/** Switched off on the Config Wheel: whatever he is doing ends, and he is gone. */
export function __shutdown() {
  for (const s of STATE.values()) { if (s.enc) safe(() => s.enc.finish(0)); s.enc = null; }
  for (const w of [...WALKERS]) safe(() => w.remove());
  for (const p of world.getAllPlayers()) { safe(() => clearFogs(p)); }
}
/** The Observer sends him after someone: his anger is up and something happens soon. */
export function __command(p) {
  const s = st(p);
  s.anger = Math.max(s.anger, MOOD_ANGER[3]);
  s.dirty = true;
  s.quietUntil = 0;
  s.nextAt = Math.min(s.nextAt, now() + 20 * 6);
}
/** His own Wheel, from the Config Wheel. */
export function __open(p) { return openWheel(p, WHEEL_API); }
''',
}


def rel_import(path_in_scripts):
    """Relative import of scripts/link/shared.js from a file at scripts/<path_in_scripts>."""
    here = os.path.dirname(os.path.join("scripts", path_in_scripts))
    r = os.path.relpath(LINK, here).replace(os.sep, "/")
    return r if r.startswith(".") else "./" + r


def patch_script(name, rel, text):
    """rel: path under the dweller's scripts/ folder."""
    for d, f, old, new in PATCHES:
        if d == name and f == rel:
            n = text.count(old)
            if n != 1:
                sys.exit(f"patch for {name}/{rel} matched {n} times: {old[:80]!r}")
            text = text.replace(old, new)
    for d, f, rx, rep, n in REGEX_PATCHES:
        if d == name and f == rel:
            text, k = re.subn(rx, rep, text)
            if k != n:
                sys.exit(f"regex patch for {name}/{rel} matched {k} times, not {n}: {rx}")
    text = text.replace("world.getAllPlayers()", f'__dw.players("{name}")')
    text = re.sub(r"(?m)^// @ts-check\s*\n", "", text)
    needs = "__dw." in text
    head = "// @ts-nocheck\n"
    if needs:
        head += f'import * as __dw from "{rel_import(os.path.join("dwellers", name, rel))}";\n'
    text = head + text
    extra = APPEND.get((name, rel))
    if extra:
        text = text.rstrip("\n") + "\n" + extra
    return text


def fix_bone_visibility(raw):
    """This game version reads bone_visibility as Molang (or numbers), not true/false: the same values as "1.0"/"0.0"
    (the Goatwalker's void fence otherwise fails to load on Bedrock Dedicated Server 1.26.52)."""
    d = load_json(raw)
    changed = [0]

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "bone_visibility" and isinstance(v, dict):
                    for bk, bv in v.items():
                        if isinstance(bv, bool):
                            v[bk] = "1.0" if bv else "0.0"
                            changed[0] += 1
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(d)
    return (json.dumps(d, indent=2) + "\n").encode("utf-8") if changed[0] else raw


def load_json(raw):
    t = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    t = re.sub(r"(?m)^\s*//.*$", "", t)
    return json.loads(t)


def merge_dict(base, add, where, depth=1):
    """Add entries of add into base (a dict), depth levels deep; equal entries are fine, different ones stop."""
    for k, v in add.items():
        if k == "format_version":
            base.setdefault(k, v)
            continue
        if k not in base:
            base[k] = v
        elif depth > 1 and isinstance(base[k], dict) and isinstance(v, dict):
            merge_dict(base[k], v, f"{where}/{k}", depth - 1)
        elif base[k] != v:
            sys.exit(f"conflict in {where}: {k}")


def merged_text(side, rel, ours_raw, parts):
    """ours_raw: current file bytes (or None); parts: [(dweller, bytes)]"""
    if rel.endswith(".lang"):
        text = ours_raw.decode("utf-8") if ours_raw else ""
        # drop any earlier merge of these blocks, then add them again
        text = re.sub(r"\n## ---- merged: [a-z]+ \(tools/merge_dwellers\.py\) ----\n.*?## ---- end merged: [a-z]+ ----\n", "\n", text, flags=re.S)
        have = {}
        for line in text.splitlines():
            m = re.match(r"([^#=\s][^=]*)=(.*)", line)
            if m:
                have[m.group(1)] = m.group(2)
        out = text.rstrip("\n") + "\n"
        for name, raw in parts:
            lines = []
            for line in raw.decode("utf-8", "replace").splitlines():
                m = re.match(r"([^#=\s][^=]*)=(.*)", line)
                if not m or m.group(1) in ("pack.name", "pack.description"):
                    continue
                k, v = m.group(1), m.group(2)
                if k in have:
                    if have[k] != v:
                        sys.exit(f"lang conflict {side}/{rel}: {k}")
                    continue
                have[k] = v
                lines.append(f"{k}={v}")
            if lines:
                out += f"\n## ---- merged: {name} (tools/merge_dwellers.py) ----\n" + "\n".join(lines) + f"\n## ---- end merged: {name} ----\n"
        return out.encode("utf-8")
    base = load_json(ours_raw) if ours_raw else None
    if rel.endswith("flipbook_textures.json"):
        base = base or []
        for name, raw in parts:
            for e in load_json(raw):
                if e not in base:
                    if any(x.get("atlas_tile") == e.get("atlas_tile") for x in base):
                        sys.exit(f"flipbook conflict: {e.get('atlas_tile')}")
                    base.append(e)
        return (json.dumps(base, indent=2) + "\n").encode("utf-8")
    base = base or {}
    if rel in ("textures/terrain_texture.json", "textures/item_texture.json"):
        # only the texture list merges; the header (this pack's name, padding, mip levels) stays the Observer's
        for name, raw in parts:
            base.setdefault("texture_data", {})
            merge_dict(base["texture_data"], load_json(raw).get("texture_data", {}), f"{side}/{rel} ({name})", 1)
        return (json.dumps(base, indent=2) + "\n").encode("utf-8")
    depth = {"blocks.json": 1, "sounds.json": 3, "sounds/sound_definitions.json": 2, "sounds/music_definitions.json": 1}[rel]
    for name, raw in parts:
        d = load_json(raw)
        if rel == "sounds/sound_definitions.json":
            for k, files in SOUND_OVERRIDES.get(name, {}).items():
                # each a full entry (the schema's form), keeping the settings the old first sound had (stream, volume, ...)
                was = d["sound_definitions"][k].get("sounds") or [{}]
                keep = {a: v for a, v in (was[0] if isinstance(was[0], dict) else {}).items() if a != "name"}
                d["sound_definitions"][k]["sounds"] = [{"name": f, **keep} for f in files]
                base.get("sound_definitions", {}).pop(k, None)   # (an earlier merge's entry, made over)
        merge_dict(base, d, f"{side}/{rel} ({name})", depth)
    return (json.dumps(base, indent=2) + "\n").encode("utf-8")


def plan():
    """Everything the merge writes: {absolute path: bytes}."""
    out = {}
    merged_parts = {}
    for name, archive, bp_dir, rp_dir in DWELLERS:
        with zipfile.ZipFile(os.path.join(SRC, archive)) as z:
            for n in z.namelist():
                if n.endswith("/") or n.startswith("/") or ".." in n.split("/"):
                    if not n.endswith("/"):
                        sys.exit(f"unsafe path in {archive}: {n}")
                    continue
                top, rel = n.split("/", 1)
                side = "BP" if top == bp_dir else "RP" if top == rp_dir else None
                if side is None:
                    sys.exit(f"unexpected folder in {archive}: {top}")
                if rel in SKIP or (name, side, rel) in SKIP_FILES:
                    continue
                data = z.read(n)
                if rel in MERGED[side]:
                    merged_parts.setdefault((side, rel), []).append((name, data))
                    continue
                root = BP if side == "BP" else RP
                if side == "BP" and rel.startswith("scripts/"):
                    srel = rel[len("scripts/"):]
                    dest = os.path.join(root, "scripts", "dwellers", name, srel)
                    if srel.endswith(".js"):
                        data = patch_script(name, srel, data.decode("utf-8")).encode("utf-8")
                    out[dest] = data
                    continue
                rel2 = RENAME.get((name, side, rel), rel)
                if side == "BP" and rel.startswith("blocks/") and rel.endswith(".json") and b"bone_visibility" in data:
                    data = fix_bone_visibility(data)
                if (name, rel) in JSON_TUNING:
                    d = load_json(data)
                    JSON_TUNING[(name, rel)](d)
                    data = (json.dumps(d, indent=2) + "\n").encode("utf-8")
                dest = os.path.join(root, rel2)
                if dest in out and out[dest] != data:
                    sys.exit(f"two dwellers write {side}/{rel2} differently")
                out[dest] = data
    for (side, rel), parts in merged_parts.items():
        root = BP if side == "BP" else RP
        dest = os.path.join(root, rel)
        ours = open(dest, "rb").read() if os.path.exists(dest) else None
        out[dest] = merged_text(side, rel, ours, parts)
    # nothing of ours may be overwritten by something different (apart from the merged files)
    merged_dests = {os.path.join(BP if s == "BP" else RP, r) for (s, r) in merged_parts}
    # the list of the dwellers' own files (copied as they are): tools/validate.mjs takes their schema findings as notes,
    # since they come verbatim from packs that already load cleanly; the server's content log is their check
    own = sorted(os.path.relpath(d, ROOT).replace(os.sep, "/") for d in out if d not in merged_dests)
    out[os.path.join(ROOT, "tools", "merged_dweller_files.txt")] = ("\n".join(own) + "\n").encode("utf-8")
    return out, merged_dests


def main():
    check = "--check" in sys.argv[1:]
    out, merged = plan()
    ours_clash = []
    bad = []
    listed = os.path.join(ROOT, "tools", "merged_dweller_files.txt")
    before = set(open(listed).read().split()) if os.path.exists(listed) else set()
    for dest, data in sorted(out.items()):
        exists = os.path.exists(dest)
        cur = open(dest, "rb").read() if exists else None
        if check:
            if cur != data:
                bad.append(os.path.relpath(dest, ROOT))
            continue
        # (a file an earlier merge wrote is the dwellers', and may change)
        if exists and dest not in merged and cur != data and "/scripts/dwellers/" not in dest.replace(os.sep, "/") \
                and os.path.relpath(dest, ROOT).replace(os.sep, "/") not in before and not dest.endswith("merged_dweller_files.txt"):
            ours_clash.append(os.path.relpath(dest, ROOT))
    if check:
        print(f"{len(out)} dweller files checked, {len(bad)} differ" + "".join(f"\n  {b}" for b in bad[:20]))
        sys.exit(1 if bad else 0)
    if ours_clash:
        sys.exit("would overwrite files that are not the dwellers': " + ", ".join(ours_clash[:10]))
    for dest, data in out.items():
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
    # files an earlier merge wrote that this one no longer does (made over since): removed
    now_listed = {os.path.relpath(d, ROOT).replace(os.sep, "/") for d in out}
    gone = sorted(before - now_listed)
    for rel in gone:
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            os.remove(p)
    print(f"merged {len(out)} files from {len(DWELLERS)} dwellers" + (f"; {len(gone)} no longer used, removed" if gone else ""))


if __name__ == "__main__":
    main()
