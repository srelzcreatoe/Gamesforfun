# Common rules for every subsystem engineer (read with your brief)

Project: "Dragon Block Sagas" — Godot 4.4.1, GDScript, gl_compatibility renderer, Android phones (landscape, 60 fps target).
Repository /home/user/Gamesforfun, Godot project /home/user/Gamesforfun/game.

Read completely before coding: game/docs/ARCHITECTURE.md, game/docs/DATA_SCHEMA.md, game/autoload/*.gd,
game/scripts/world/WorldConst.gd, game/scenes/main/Main.gd, game/project.godot. Your brief names the sections that are your contract.

Working rules
* Edit ONLY the files/folders your brief assigns to you (plus tests you add under game/tests/ and new signals appended to game/autoload/Events.gd).
* Run Godot in a private sandbox copy, never in game/ directly:
    P=$(/home/user/Gamesforfun/tools/sandbox.sh <your-name>)
    /home/user/Gamesforfun/tools/godot.sh --headless --path $P --quit-after 3 2>&1 | grep -E "SCRIPT ERROR|Parse|SHADER|ERROR"
  Re-run sandbox.sh before every Godot run so it picks up your edits (it mirrors game/ including the import cache).
* Tests: game/tests/test_<topic>.gd extending TestCase (game/tests/TestCase.gd; `add_node(n)` adds a node to the tree, `tree` is the SceneTree).
  Run: /home/user/Gamesforfun/tools/run_tests.sh <your-name> <filter>   (exit code 1 on failure; prints ok/FAIL per test)
* Screenshots (llvmpipe under Xvfb, slow but complete):
    /home/user/Gamesforfun/tools/screenshot.sh /tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/shots/<name>.png --sandbox <your-name> [--scene res://...tscn] [--seconds N] [--args "--flag=value ..."] [--size WxH]
  Then LOOK at the PNG with the Read tool and fix what is wrong. Never report a visual feature done without having looked at it.
* Typed GDScript (`var x: int`, `-> void`), `class_name` per reusable class, no physics bodies (physics engine is Dummy), no features the
  compatibility renderer lacks (no SSR/SSAO/volumetric fog/compute/Texture3D/GPUParticles sub-emitters). `inference_on_variant` is only a warning here.
* Other subsystems are being written concurrently. Code against the contracts; guard cross-subsystem calls with
  `ResourceLoader.exists("res://...")`, `has_method`, `get_node_or_null` and provide graceful fallbacks so your part runs alone.
* Do not commit to git. Do not modify files owned by others; if you need a change there, put it in your final report.
* Final report (your last message): files written, test summary line, screenshots you verified (paths + what they show), public API you expose,
  integration points/fallbacks, performance numbers, limitations, contract changes you need.
