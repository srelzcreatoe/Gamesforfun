# Known limitations

## Not verified in a real game client

- **No client test has been done.** Everything visual and audible was verified offline:
  - the controller and Molang simulator plus grounding solver;
  - software renders of the composite poses;
  - spectrogram and loudness review of every sound;
  - Mojang Creator Tools schema validation.

  Gameplay was verified on a dedicated server with a stand-in player. Things that can only
  be judged in a client:
  - whether the poses read as scary at game distances and lighting;
  - the actual loudness of each sound against vanilla;
  - how strong the fog, FOV and shake feel;
  - music looping;
  - whether teleport-every-tick during the grab looks smooth or jittery on the victim's
    screen.
- **Nobody has listened to the sounds** on speakers or headphones. They were designed and
  checked numerically (spectra, envelopes, peak and RMS). Some may need level or tone
  tweaks after a listen (`tools/gen_audio_v2.py` makes each a one-line change).
- **Camera FOV reset** uses `/camera @s fov_clear` (documented syntax; it parses on BDS)
  because the script API does not document how to clear a scripted FOV. If it ever fails
  on a client, players can set Camera effects to *Reduced* (no FOV changes), or run
  `/tailwail:debug restore`.

## Behaviour

- The "on screen" test uses a generous ~72° cone with line of sight to three body points.
  With an extreme FOV, or the creature filling the edge of the screen, it is possible to
  see a sliver of it move.
- Navigation is the engine's own pathfinder toward an invisible lure. It can still lose
  time on complex terrain: stuck detection, sidestep recovery and a give-up into search
  exist, but caves with drops, scaffolding or water may look clumsy.
- Hiding is based on block light at your head and crouching. Dynamic light from a held
  torch does not exist in Bedrock, so holding a torch does not give you away by itself.
- Presence events pick positions from loaded terrain with bounded searches. In very open
  or very cramped places some events find no valid spot and are skipped (the knock needs
  a wall behind you; the peek needs a corner).
- A grab needs about 4 blocks of headroom. In low tunnels it strikes instead.
- The fake chat line only goes to the haunted player, but on servers with chat logging it
  is a real message to that player.

## Content and performance

- **One creature.** Depth over breadth: there is no roster of dwellers.
- No custom structures, biomes or lore buildings.
- Decision-tick cost was measured only on BDS (2.3 ms average for three encounters, on a
  development container CPU). Client rendering cost of the 268-cube model with up to four
  layered clips has not been profiled. The 183-cube mane was not simplified.
- Sounds are mono, 44.1 kHz Ogg Vorbis (~2.3 MB total). Music streams.

## Compatibility

- Needs Bedrock 1.26.60+ (stable script modules 2.11.0 / 2.3.0). On older clients the packs
  will not load.
- Other add-ons that also use `player.playMusic`, fog stacks or input permissions can
  interfere during an encounter. Tailwail only removes fog entries carrying its own tag.
