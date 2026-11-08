"""Builds FEATURES.md: the 140-feature audit (L01-L90, N01-N50) from the encounter templates'
own feature tags plus the system-level implementations listed below."""
import os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
names = dict(line.rstrip('\n').split('\t', 1) for line in open(os.path.join(ROOT, 'src_assets/design/feature_names.tsv')) if '\t' in line)

# template id -> feature ids, parsed from the scripts (single source of truth)
tpl = {}
for p in glob.glob(os.path.join(ROOT, 'Shaftbreaker_BP/scripts/ai/encounters/*.js')):
    src = open(p).read()
    for m in re.finditer(r"id: '([a-z_0-9]+)', features: \[([^\]]*)\]", src):
        tpl[m.group(1)] = re.findall(r"'([LN]\d{2})'", m.group(2))
by_feat = {}
for t, fs in tpl.items():
    for f in fs:
        by_feat.setdefault(f, []).append(t)

SYSTEM = {
    'L02': 'idle `dormant` pose + TWITCH act after a long hold (impossible_stillness)',
    'L10': 'all spawns validated dark and off-screen for every nearby player (common.appear / space.findSpot)',
    'L26': 'passiveExit("moths"): the figure bursts into original Shaft Moths and is gone',
    'L36': 'damage_sensor: fire and fire_tick x0.5, fall x0.4; lava still hurts and navigation avoids damage blocks',
    'L39': 'long-arm attack clips; damage only on the hit frame of the engine `delayed_attack` or a scripted strike with line-of-sight',
    'L42': '112 HP; lethal hits become a scripted collapse (damage_sensor -> sb:defeated) and drop the trophy',
    'L43': 'it is an ordinary mob for effects: invisibility hides you from its line-of-sight checks, weakness/slowness apply',
    'L44': 'ai/memory.js: 14 bounded signals (score + confidence), saturation, decay, counter-learning',
    'L45': 'escape_door unlocked -> `sb:nav_doors` navigation (opens wooden doors)',
    'L47': 'escape_pillars -> `sb:nav_climb` (spider-style wall navigation)',
    'L48': 'Breaker only opens a path after a real stall, protected-block checks, 14-block cap per hunt',
    'L49': 'torch/lantern placements underground feed `uses_torches` (rate-limited)',
    'L51': 'explosions / TNT placed during a hunt feed trap_reuse; trap recognition makes it hesitate',
    'L55': 'director.familyMul: caught-ratio, escape count, danger budget and recent-end penalties',
    'L56': 'audio.maybeRoomTone: occasional original room tone while interest is up',
    'L57': 'positional 3D sounds + heartbeat bands (never exact coordinates); brain.presenceAudio: presence / close music beds from its real distance',
    'L77': 'den.tickMoths: a moth flutters in near underground players while a den exists (backs off if ignored)',
    'L78': 'den.tickGuides: guide moths fly an A* air route to the Den Heart, nose pointed along it, then circle the heart',
    'L79': 'natural moths wander (random hover, avoid the creature); guides wait and point at the den when you fall behind',
    'L80': 'a new guide every few minutes until you have found the den; fewer for players who ignore them',
    'L03': 'brain.lurkTick: once you have been underground about a minute it arrives out of sight and shadows you through the real cave',
    'L58': 'animation-timed step/scrape/smash sounds from the model locators; soft footsteps from its walk cycle; ambient breathing when idle',
    'L61': 'per-player heartbeat (only that player hears it); toggle in personal settings',
    'L62': 'heartbeat BPM 64-150 follows perceived danger (distance, visibility, hunt state)',
    'L63': 'original chase score (music.shaftbreaker.chase) only in real hunts; off with reduced-chase',
    'L64': 'original standoff drone (music.shaftbreaker.standoff)',
    'L65': 'layers chosen by phase/encounter: room tone, drone, chase, positional effects',
    'L66': 'pacing escalates from tiny audio cues to hunts, with cooldowns',
    'L69': 'original den blocks: Den Heart, Den Spine, Den Dust, Fractured Den Wall',
    'L70': 'hanging den spines (block state hanging=true) and webs under den ceilings',
    'L71': 'skeleton skull block placed in dens; bones in abandoned meals',
    'L73': 'breaking the Den Heart suppresses encounters within 72 blocks for 3 in-game days',
    'L76': 'original moth model and texture (angular dust wings, bone-white eyes, glow motes)',
    'L81': 'cleansing a den is a non-combat way to weaken the territory; its hidden passage opens',
    'L83': 'defeat drops the Shaftbreaker Skull (configurable)',
    'L84': 'skull is wearable (slot.armor.head) with an attachable head model',
    'L85': 'night vision underground while worn (configurable)',
    'L86': 'optional subtle camera pulse while worn (off by default, respects reduced flicker)',
    'L87': 'wearable protection 2',
    'L88': 'scripted COLLAPSE / VANISH clips; no morphing',
    'L90': 'familiarity progression gates templates; rare cinematics; memory decays',
    'N11': 'learnFromHunt stores escape-route regions; ambush intercepts after 3 uses',
    'N14': 'lingering after an escape bumps shelter regions; watch/ambush prefer them',
    'N17': 'trap_reuse unlocked -> it may stop and LISTEN before a hazard (never guaranteed)',
    'N19': 'director.onPlayerHitMob: how you fight other mobs feeds melee_retreat (capped)',
    'N20': 'director.provoke: flight, staring and approaches feed a noisy provocation meter',
    'N22': 'creature.updateSqueeze: shoulder twist through one-wide gaps (animation only, no phasing)',
    'N27': 'heavy hits play RECOVER / RECOVER_MIRROR (planted arm, unfolding torso)',
    'N43': 'scratch decals are long-lived particles on wall faces: no block is modified',
    'N48': 'dens can be listening chambers: your mining there echoes and raises its interest',
    'N49': 'dens may grow a Fractured Den Wall between caves; it opens on cleansing or when the Breaker needs it',
}

rows = []
done = 0
for fid in sorted(names, key=lambda k: (k[0], int(k[1:]))):
    impl = []
    if fid in by_feat:
        impl.append('encounters: ' + ', '.join(f'`{t}`' for t in sorted(by_feat[fid])))
    if fid in SYSTEM:
        impl.append(SYSTEM[fid])
    status = 'Implemented' if impl else 'Not implemented'
    if impl:
        done += 1
    rows.append(f'| {fid} | {names[fid]} | {status} | {"; ".join(impl) if impl else "-"} |')

md = [
    '# Feature audit: L01-L90, N01-N50',
    '',
    f'Generated by `tools/gen_features.py` from the encounter templates\' own feature tags and the system list. **{done}/140** have an implementation in this build.',
    '',
    '"Implemented" means the behaviour exists in code and was exercised by the offline simulator; it does not mean it was play-tested in the Minecraft client (see README, "What was and was not verified").',
    '',
    '| ID | Feature | Status | Where / how |',
    '|---|---|---|---|',
    *rows,
    '',
]
open(os.path.join(ROOT, 'FEATURES.md'), 'w').write('\n'.join(md))
print(f'{done}/140 implemented')
missing = [r for r in rows if 'Not implemented' in r]
for r in missing:
    print(r)
