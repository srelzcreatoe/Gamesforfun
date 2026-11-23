# Basiliskra IV and the next batch: what was asked for

The project owner's brief, kept here so that none of it is lost between sessions. Order of work: **the Form IV
model first, then stop for approval**; then everything else.

## Status

* **1.4.0**: everything under "2. Bugs to fix" and "3. Changes asked for", the journal's checklist for each change,
  and the three themes.
* **1.5.0**: Basiliskra IV is in the game (`src/forms/four.ts`): he roams and destroys, every footfall a crater, the
  breath from 150 blocks, the stare, and all six set pieces. He comes to be when Basiliskra III has had three days
  (from 1.6 that is all it takes; before, also twelve beams, night, and a player near) or at once from the config wheel. Set piece 1 is staged
  wherever he arrives; called back near the sea he comes out of the water for it. What differs from the brief:
  in set piece 4 no water is moved and no fish are stranded before the wave (cod are left after it); in set piece 1
  the "row of spines moving beneath the ocean" is not drawn (he wades out through a rift).
* **1.6.0**: a second brief (a message with three pictures: two voxel cities seen from the air and the shore, and a
  blocky toy-like gun with a red crystal barrel). What was asked, and what was built:
  * *"some of them get out of frame cuz it's zoomed out in the cutscene ... have it be much closer"*, *"make each
    transformation cinematic"*: the change is now five cut shots, each placed from his own size and facing
    (`scene.ts` shots; `controller.ts` evolve), HUD hidden, name card.
  * *"only have the requirements be ... how many minutes pass"*: time is all a change waits on (`brain.ts`
    `changeTicks`); the Settings have "Minutes in each form before he changes".
  * *"go to the nearest village it can find and start destroying it"*: `settlementNear` and the `raze` act (II, III, IV).
  * *"a biome where big cities can spawn in with people ... spawned next to the player too ... a beach ... the water
    ocean deep and I mean DEEP DEEP with custom blocks and structures"*: `city.ts`. **Not a biome**: a custom biome
    needs the game's Custom Biomes experiment, and the pack runs with none. Cities are raised by the script on real
    coasts as players explore, and where an operator stands (wheel, `/basiliskra:city`); each has a beach and a sea
    cut 102 blocks deep, lined, with four new blocks and several structures on its floor.
  * *"a separate 4th form balisikra for kaiju battles in creative that is much stronger than the survival one"*:
    the Titan (`titan.ts`, entity `basiliskra:titan`).
  * *"a specific gun that is made to shoot basiliskra that looks like it's from pixel gun 3d"*: the Seam Lance
    (`lance.ts`, `tools/kit/gen_lance.py`), an original design in that blocky style.
* None of it has been seen in game: see `docs/TEST_REPORT.md`.

At model scale he is 27.5 blocks to the top of the skull (33.8 to the wing claws), 54.5 across the wings and 44.5
from muzzle to club; 1,464 cubes, 69 bones, a 2048 x 2048 texture. `DRAW_SCALE` gives him 2.0 for now (55 blocks
tall in game); that number is easy to change.

Built into the model for the set pieces below: `plate_break` (the dorsal plate that cracks off, its own bone),
`ribs_l` (the flank that glows when he swallows a charge), `wing_vein_l0..3` / `wing_vein_r0..3` (where the wing
veins discharge), `wing_tip_l/r`, `heel_l/r` and `foot_l/r` (the skid and the pivot), `hand_l/r` (dragging the
seabed), and the club with `club_core` and twelve `spike_tip_*`. Each wing folds: arm, forearm and four fingers
are separate bones and each carries its own membrane.

## 1. Basiliskra IV (the model comes first)

An upright, winged form, from three reference pictures (back, front, side): a heavy biped on thick legs, long
clawed arms, two great veined wings, crimson spines from skull to tail, the spiked tail club. In Basiliskra's own
design language (his small pale eye under a heavy brow, the old gill scars, the flame-shaped crests, the pale notch
in his tail, the club he already has). As accurate, terrifying, rigid and stable as possible.

What he does:

* Roams the whole world and destroys everything in his path: with each footstep, destruction under his feet, like
  the Wither.
* Destroys every mob he sees, and the player too, especially from afar.
* **The stare**: he looks at a player for a while, which gives the player slowness; after a while it wears off.

Set pieces (the owner's own words, shortened):

1. **The first roar comes after the beam.** At night a row of crimson spines moves beneath the ocean. A thin red
   beam comes out of the water and cuts a glowing line across the beach. Three seconds of quiet. Sand along that
   line pops into glass, one block at a time, back toward the sea. When the last block turns, the water erupts and
   he rises out of it roaring.
2. **He uses his tail club to turn mid-beam** (his signature). The beam pushes him backward: both heels skid. He
   drives the spiked club into the ground, takes one enormous sideways step and pivots his whole body round the
   buried club, dragging the beam across the landscape. Readable from his feet: if his left foot lifts while the
   club is planted, that is the way the sweep will go. The safe move is to run toward the buried tail (inside the
   arc), and be gone when he rips the club free.
3. **His wings catch the recoil when his jaw fails.** Sometimes the charge goes wrong: the mouth opens, the sound
   cuts out, a little red light leaks between his teeth. Both wings slam open and each branching vein discharges a
   thin red beam into the ground behind him: a fan of smoking lines. Standing directly in front of his face is the
   safe spot, looking into the open mouth where the light struggles to come back.
4. **He drags the seabed ashore.** In shallow water he plants both feet, reaches down with his longer arms, digs
   his claws into the bottom; his shoulders rise; fish flop on the exposed seabed; he hauls both arms to his chest.
   A broad front of black water, gravel and kelp races up the beach; boats are shoved inland; anyone in its path is
   swept toward the village. Afterwards: a fishing boat stranded on the village road, a live cod flapping beside
   it. Staged as a moving wave of particles and knockback across one stretch of shore, without flooding the map.
5. **His broken dorsal plate keeps charging.** One damaged crimson plate cracks off his back and buries itself
   point-first in the ground, taller than the player. Whenever he charges, the fallen plate lights in the same
   rhythm as the gap in his spine. On his next shot he fires into it: the beam leaves the broken face at a sharp
   angle and hits whatever sheltered behind cover. Once it burns out the blackened plate stays as a landmark.
6. **The beam he swallows.** He starts charging with his mouth open, sees you reach cover, and clamps his jaws
   shut. The glow travels back down his throat until one side of his rib cage turns red under the scales. He
   carries the charge while he walks, comes round the hill with his mouth dark, and fires the instant he sees you.
   The limit: a red pulse climbs his neck; on the third pulse he must open his mouth and vent. Lead him to face
   the open sea and the shot goes over the horizon.

## 2. Bugs to fix

* **Send him back / Call him / Bring him here**: sending him back does not make him go away for good (he
  teleports off and returns); calling him gives the same transformation that was spawned; after "Bring him here"
  the whole thing breaks: they float in the air and the AI is gone.
* **The rift never seems to open.** Nothing happens.
* **Hitboxes**: hitting the head does nothing unless the player goes inside him. The hitbox must reach from tail
  to head on every form.

## 3. Changes asked for

* Form III: every step destroys everything in his path, walking *through* things (not falling through).
* Everything he does is heard from 200 blocks: the beam, his noises, the roar.
* The beam, the roars and every sound timed to their animations.
* A much cooler beam.
* Better pathfinding for all forms.
* The rift made very cool and flashy.
* A short cutscene of him appearing from the rift, and one for every transformation.
* New glowing custom blocks and items for the radiation; the radiation noticeable and strong; it spreads for a
  while, then goes away.
* Three terrifying kaiju themes for him, two minutes each at least, high quality (not just a bunch of synths).

## 4. How he evolves (asked, answered in chat; to be made clearer in game)

I to II: two days, six surfacings, three spasms, then a sand or gravel shore with someone near.
II to III: two days and 220 blocks dragged, then night or rain with someone near. IV: to be designed.
