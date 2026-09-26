# Brief: COMBAT, KI & FX engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §8 (combat/forms) + the fx parts of §7; also §3, §4, §6, §12; DATA_SCHEMA.md (techniques.json,
forms.json, skills.json, races.json, Profile). Concurrently: the entity engineer writes scripts/entity/Entity.gd, BedrockModel.gd, BedrockAnimation.gd
(DMZ aura meshes: assets/models/entity/races/kiaura.geo.json, kiaura2.geo.json with bones aura/top/mid/down...; textures entity/races/aura/kakarot_aura.png,
god_aura.png, kakarot_cross.png, sparking_effects.png; entity/ki/aura_ki_0..3.png, kiblast.png, kiwave.png, kidisc.png, ki_laser.png, kiblast_sparkle1/2.png);
the data engineer writes data/techniques.json, forms.json, skills.json, races.json — code against the schema with test fixtures. Particle sprites:
game/assets/textures/particles/ (DMZ: aura_0..4, ki_exp0..6, ki_flash, ki_flash1, ki_line, ki_spark_0..2, ki_trail0..5, explode0..5, spark1..5,
dust_particle_0..3, rock_particle_0..11, punch_particle_0..4, divine_particle_0..3, block_0..2), particles/aaa/** (lightning/Thunder_Bold.png,
Thunder_Thin.png, Shockwave.png, Burst_1/2.png, Smoke.png, Fire.png, Particle_Soft/Hard.png, Glass.png; explosion/**: fire_tex.png, smoke_tex.png,
Shockwave.png; explosion_mini/*: Flash01.png, hit.png, ColorNoise.png; essentials/*: SHINE_001.png, SPARKLE001.png, Circle.png, SMOKE001..004.png,
AlphaGradient.png; missile_boost/*: Star.png). Sounds (game/assets/audio/sfx): ki_charge_loop, ki_kame_charge/fire, ki_finalflash_*, ki_beam_*,
ki_disk_*, ki_burning_*, ki_explosion_charge/impact, ki_spiritbomb_*, ki_supernova_*, kiblast_shoot, ki_sparks, aura_start, transform_on/off,
insta_form_on/off, stack_form, no_ki_form, golpe1..6, critico1..2, block1..3, parry, evasion1..2, knockback_character, dragon_fist, zanzoken, laserbeam,
lockon, oozaru_*, plus generated: shockwave, lightning_crack, power_up_burst, explosion_big, whoosh, dash, aura_loop, thunder, heal, teleport.

You own: game/scripts/combat/** (Stats.gd, Damage.gd, Ki.gd, Techniques.gd, Projectile.gd, Beam.gd, Explosion.gd, Forms.gd, Skills.gd, Training.gd,
LockOn.gd), game/scripts/fx/** (TransformationDirector.gd, Aura.gd, AuraLightning.gd, ScreenFx.gd, KiEffects.gd, HitFx.gd, ExplosionFx.gd, Trails.gd),
game/scenes/entities/KiBlast.tscn, KiBeam.tscn, KiDisc.tscn, game/scenes/fx/*.tscn (incl. FxPreview.tscn), game/shaders/aura.gdshader,
ki_beam.gdshader, ki_sphere.gdshader, shockwave.gdshader (+ flash/dissolve shaders), game/tests/test_combat_*.gd, test_forms.gd.

Deliverables:
1. `Stats.gd` (RefCounted) per §8 with race/class/form multipliers, `level()`, derived values, `raise(stat, points)` with cost
   `floor(40 * 1.08 ^ (points_in_stat/5))`, `from_profile/to_profile`, `effective(stat)`; `Damage.gd` static formulas (defense `dmg*100/(100+def)`,
   crit by SKP, ki protection, knockback, kinds melee/ki/explosion/fall/drown/void/planet, `Game.difficulty_mult()`); `Ki.gd` (max ki, passive regen,
   hold-to-charge +12%/s × ki_control level with `ki_charge_loop` and aura growth, Events.ki_charge_changed, costs, stamina for melee/dash/fly-fast,
   `power_release` 10-100%).
2. `Techniques.gd` executor for ANY Entity: `begin(entity, technique_id)` (ki check, cast_anim, charge_sound, charge particles + aura pulse,
   `charge_progress`), `release(entity)` -> blast (KiBlast.tscn: emissive sphere with ki_sphere.gdshader, trail, 30 m/s, voxel raycast per frame,
   entity AABB hits, explode; terrain damage only above a damage threshold), beam (KiBeam.tscn: ki_beam.gdshader cylinder from the hand along the aim,
   grows to hit/max length, sustained while held up to `duration`, damage ticks, push, crater at the end, shake; charging sphere in the hands), disc
   (spinning flat disc cutting blocks with hardness < 3), barrage (10 blasts/s), explosion (self-centred; Final Explosion drains all ki), buff
   (kaioken via Forms; solar flare blinds 4 s + white flash), grab (dash + skp.* multi-hit), melee specials (dragon_fist/meteor/wolf_fang/deadly_dance).
   Cooldowns; AI uses the same executor; Events.technique_started/fired.
3. `Forms.gd` per §8: unlock rules (skill level, TP cost), `transform(entity, form_id)` -> TransformationDirector then multipliers via Stats, model
   scaling, hair/eye/body via `RaceSkin.apply_form_visuals` (fallback modulate), `model_override` swap (e.g. Oozaru), aura colour/lightning, ki drain
   (`energyDrain` × max/100 per s), health drain, mastery (per hit dealt/received, passive per 5 s, `maxMastery`, reduces drain), stacking when
   `formStackable`, `revert()` on depletion, `incompatibleWith`. Bosses use the same path.
4. `TransformationDirector.gd` — THE cinematic (≈3.5 s): input lock + Events.transformation_started, BGM "transformation", transform_on +
   power_up_burst; camera orbit + push-in via `Game.player.camera_rig.cinematic_orbit(...)` if present else animate the active Camera3D; FOV widen;
   Engine.time_scale 0.6 for 1.5 s (restore safely); ground dust ring, 8-14 levitating rock cubes that orbit and shatter, cracked-ground decal quad
   (procedural), expanding shockwave.gdshader rings; body: aura mesh (Aura.gd: DMZ kiaura geo + aura.gdshader procedural scrolling flame noise in
   `auraColor`, additive, vertex wobble, pulsing, inner layer), AuraLightning.gd (Thunder_Bold/Thin billboards jittering around the body when
   `hasLightnings`, `lightningColor`, occasional lightning_crack), white body flashes, hair flicker between colours every 0.15 s, eye glow; climax:
   screen flash (Events.screen_flash + own additive ColorRect), big shockwave + burst particles, Events.screen_shake(1.0, 0.5), hit-stop; settle:
   persistent idle aura (stays while power_release > 70% or charging), BGM back. Giant forms scale over the sequence. `play_for(entity, id)` for boss
   phases. Mobile-safe: CPUParticles3D ≤ 300 total, billboards, no lights except one OmniLight3D at the climax.
5. Runtime `Aura.gd` (intensity from charging/power release/form; race or form colour; flame layers; sparks + rising particles; ground light quad;
   aura_loop), `Trails.gd` (ki trail when flying fast; dash afterimages: 3 fading model copies + zanzoken).
6. `HitFx.gd`/`ExplosionFx.gd`/`ScreenFx.gd`: punch impact (punch_particle sprites, golpe sounds, hit-stop 0.05 s, shake by damage), crit flash,
   block/parry sparks, Events.damage_number, explosion (flash sprite, fire/smoke billboards, shockwave ring, debris cubes, crater via World.explode,
   ki_explosion_impact + explosion_big), ScreenFx (flash/vignette/low-health pulse, slow-mo helper, cheap chromatic aberration canvas shader).
7. `Skills.gd` (per-frame level effects: speed/jump/fly/ki regen/potential unlock cap; `instant_transmission(target_pos)` with teleport sound + flash),
   `LockOn.gd` (nearest visible entity in a 48 m cone; `player.target`; lockon sound; Events.target_changed).
8. `Training.gd`: TP from combat (damage dealt/taken × difficulty), training post hold-to-train (stamina cost, diminishing returns), gravity device
   (gravity multiplier + TP multiplier), meditation (passive ki regen in base.meditation). Events.tp_changed.
9. `scenes/fx/FxPreview.tscn` with `--args "--fx=transform --form=ssgrades.supersaiyan"` / `--fx=kamehameha` / `--fx=explosion` / `--fx=aura`
   (dummy entity: BedrockModel entity/races/human if available else a capsule) on a flat plane; screenshots at `--seconds 1.2`, `2.4`, `3.5`; LOOK
   at them: aura reads as flames, lightning arcs visible, flash/shockwave present, beam is a glowing energy cylinder with a core, blasts glow.
10. Tests: Stats math, Damage formulas, Forms unlock/drain/mastery/stacking with fixtures, Techniques cost/cooldown state machine with a fake entity,
    Ki charge math.

Report the public API other subsystems call (Techniques.begin/release, Forms.transform, HitFx.on_hit, Aura.set_intensity...) and particle/ms budgets.
