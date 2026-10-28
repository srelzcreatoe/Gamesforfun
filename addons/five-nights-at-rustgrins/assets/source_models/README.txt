FNAF ANIMATRONICS - ALL SIX (models + animations)
=================================================
Rustgrin, Mirehop, Noxbriar, Purple Rat, Cat, Top-Hat Rat

WHAT'S IN THIS ZIP
  Blockbench/
      Rustgrin.bbmodel  Mirehop.bbmodel  Noxbriar.bbmodel
      PurpleRat.bbmodel Cat.bbmodel      TopHatRat.bbmodel
      Each file has the model, its texture and all 8 animations inside.
      Blockbench: File > Open Model, then the Animate tab.
  Bedrock/
      FNAF_Animatronics_RP/     resource pack: Rustgrin, Mirehop, Noxbriar
      FNAF_Animatronics_2_RP/   resource pack: Purple Rat, Cat, Top-Hat Rat
      FNAF_Animatronics_RP.mcpack, FNAF_Animatronics_2_RP.mcpack
          the same packs ready to double-click into Minecraft
      Each pack: models/entity/*.geo.json, animations/*.animation.json,
      textures/entity/*.png, entity/*.entity.json,
      animation_controllers/*.ac.json (idle/walk/run by speed), manifest.json
      The packs keep their old IDs with a higher version number, so they
      replace the copies you already have.

NEW: ANIMATED HANDS
  Every animation now moves the fingers, on all six:
    idle          servo "finger rolls" - the fingers curl one after another
                  and let go, alternating hands
    perform 1/2   finger accents on the beat and finger rolls on free hands;
                  hands holding a prop give it a light squeeze on the beat
                  (the mic, maracas, cane and guitar neck never slip)
    walk / run    fingers curl a little as each arm swings forward and relax
                  as it swings back
    jumpscare     claws open wide, then slowly clench with a slight tremble
    pose 1        a finger roll on each hand
    pose 2        powered down: a single malfunction finger twitch
  Every hand pose (relaxed, grip, fist, claw, open hand, point, ...) was
  re-solved for each character's own hand so that:
    - no finger or thumb joint ever bends backwards,
    - fingers never sink into the palm, the thumb or each other,
    - fingers never pass through the body, head, legs or tail,
  and every frame of every animation was checked for all of the above.

ANIMATIONS  (animation.<id>.<anim>)
  idle        loop   stage idle
  perform_1   loop   main show routine (4 s, 120 bpm)
  perform_2   loop   second show routine
  walk        loop   mechanical walk, feet planted
  run         loop
  jumpscare   plays once and holds the last frame (UCN style, arms wide)
  pose_1      loop   stage pose
  pose_2      loop   powered-down slump

  Rustgrin     lead singer with a hand mic
  Mirehop      guitarist (rhythm part / guitar solo)
  Noxbriar     backup singer, presents and waves to the crowd
  Purple Rat   maraca player, nervous and twitchy, scurries
  Cat          stage dancer: paw-swipe dance, jazz hands, prowls
  Top-Hat Rat  ringmaster with a cane: "step right up", cane flourish, bow

ENTITY IDS
  fnaf:rustgrin  fnaf:mirehop  fnaf:noxbriar
  fnaf:purple_rat  fnaf:cat  fnaf:top_hat_rat
  One-shot animations, e.g.:
    /playanimation @e[type=fnaf:cat,c=1] animation.cat.jumpscare
  Tip: for the cleanest shows, add perform_1/perform_2 as states in your own
  animation controller instead of layering them over idle with /playanimation
  (layered animations add their rotations together).

BONES
  root > waist > torso > head > jaw / hat / ears
  <side>_arm > <side>_forearm > <side>_hand >
      <side>_finger1..3 > _mid > _tip,   <side>_thumb > _tip
  <side>_leg > <side>_shin > <side>_foot          (side = right / left)
  tail_1 > tail_2 > ...  (Purple Rat, Cat, Top-Hat Rat)
  Props: microphone (Rustgrin), guitar (Mirehop), right_maraca / left_maraca
  (Purple Rat), right_cane (Top-Hat Rat). They show in idle, perform_1,
  perform_2 and pose_1 and are hidden in walk, run, jumpscare and pose_2.
  Top-Hat Rat's fingers rest in a loose fist (like his picture), so his hands
  look right in Blockbench's Edit tab too.
