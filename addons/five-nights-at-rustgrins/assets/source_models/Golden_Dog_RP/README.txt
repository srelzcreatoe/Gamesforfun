THE GOLDEN DOG (model + animations)
===================================
Every file in this pack is written by tools/entities/golden_dog.py and
tools/entities/golden_dog_anims.py. Do not edit them by hand: change the generator
and run it (tools/entities/build_entities.py does that itself when the generator has
changed). Reference picture: assets/reference/golden_dog.webp; what he is for:
docs/GOLDEN_DOG.md.

Same layout as the two supplied packs:
  models/entity/golden_dog.geo.json        geometry.golden_dog, texture 512 x 1024
  textures/entity/golden_dog.png           the body
  textures/entity/golden_dog_mer.png       metalness / (emissive) / roughness as painted:
                                           brass and joints shiny, fur rough
  textures/entity/golden_dog_pupils.png    white where the pupils glow (his pupils are
                                           pale: the build cannot find them by colour)
  animations/golden_dog.animation.json     the eight animations below
  entity/, animation_controllers/, manifest.json   as in the other packs (fnaf:golden_dog)

SIZE
  44 model pixels tall with his hat. The add-on draws him at scale 1.27
  (tools/entities/build_entities.py MODELS): 3.5 blocks, where the others stand 3.

BONES  (the cast's rig, one more finger per hand, a five-bone tail)
  root > waist > torso > head > jaw / hat / right_ear / left_ear
  <side>_arm > <side>_forearm > <side>_hand >
      <side>_finger1..4 > _mid > _tip,   <side>_thumb > _tip
  <side>_leg > <side>_shin > <side>_foot          (side = right / left)
  tail_1 > ... > tail_5
  The hand bones are turned a quarter (rest rotation): the backs of his hands face
  forward when his arms hang, the fingers curl towards the back. The ears hang from
  the top corners of the head and are splayed by their bones' rest rotation.

ANIMATIONS  (animation.golden_dog.<name>)
  idle        loop 8 s  he stands and breathes; once, his head tips to one side and
                        stays there: a dog listening to something under the floor
  perform_1   loop 4 s  the old crooner: a slow sway, the left hand on his lapel, the
                        right hand beating time with one finger
  perform_2   loop 4 s  the right hand to his chest, a bow of the head (the hat tips on
                        its own servo), then both arms open wide
  walk        loop 2.4 s  slow and heavy, the weight rolling from foot to foot
  run         loop 1 s  a lumbering charge, hands out to grab, ears streaming back
  jumpscare   1.6 s, holds the last frame: he bends down over you, the jaw drops off its
                        hinge, hands up either side of his face; the head thrashes,
                        stops dead, and tilts
  pose_1      loop 2 s  the stage pose: tall, the left hand on his lapel
  pose_2      loop 2 s  powered down on his stage: chin on his chest, ears fallen
                        forward, arms dead weight; one finger twitches
