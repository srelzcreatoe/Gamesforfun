THE HOLLOW DWELLER

Open Hollow_Dweller.bbmodel in Blockbench (File > Open Model).
The texture is embedded, so the project opens as a single self-contained file.
Switch to Animate, choose one of the five animations, and press Play.

ANIMATIONS
animation.dweller.idle     4.00 s  Loop: slow breathing and slight head drift.
animation.dweller.pose     1.50 s  Hold: settles into the crooked reference pose.
animation.dweller.staring  5.00 s  Loop: rigid gaze with abrupt head turns.
animation.dweller.running  0.80 s  Loop: forward lean, alternating stride and arms.
animation.dweller.attack   1.25 s  Once: windup, overhead double strike, recovery.

MODEL
185 textured cubes; 36 bones; one root hierarchy; 1024 x 512 pixel texture.
Height: approximately 64.35 model units (4.02 Minecraft blocks).
Every articulated joint has overlapping geometry at its shared pivot.
Elbows flex forward; knees flex anatomically behind the thighs. Neither
hinge crosses through its straight position into reverse flexion.
All geometry and keyframes remain editable in Blockbench.
The face has no mouth. Both wrists, all eight fingers, and both thumbs are
animated in every clip. Fingers have separate knuckle and fingertip joints;
their gentle curls follow the palm direction, with no reverse bending.

FILES
Hollow_Dweller.bbmodel          Main editable model, texture, and animations.
dweller_texture.png            Separate texture atlas for game integration.
hollow_dweller.geo.json        Bedrock geometry export.
hollow_dweller.animation.json  Bedrock-format animation export.
dweller_preview.png            Render of the model in its pose animation.
dweller_turnaround.png         Front, side, and back views.
dweller_animations.gif         Preview of all five animations.

The model is a recreation of the supplied front, back, side, and tilted
reference images. White eyes are part of the texture; actual emitted light
or bloom depends on your game's material/shader setup.

The JSON exports are assets for integration, not an installable Minecraft mod
or add-on. A game entity definition, behavior and animation selection still
need to be connected in the target mod/add-on. The Blockbench file can be
opened and animated directly without that integration.
