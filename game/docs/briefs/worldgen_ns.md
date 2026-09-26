# Brief: WORLD GENERATION, part 2 — Nature's Spirit biomes + dramatic terrain

Read COMMON.md and your original worldgen.md first (this extends it; keep everything that works). The user supplied the Nature's Spirit biome mod
(extracted at /tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/ns, data/natures_spirit/worldgen/biome/*.json =
51 biomes, configured/placed features = tree and plant shapes) and wants (a) its biomes in the game and (b) terrain that looks like the modern Minecraft
terrain-generation mods (Terralith / Tectonic style: tall mountain ranges with snow caps and cliffs, deep river valleys, rolling hills, plateaus and
canyons, coastal cliffs, large lakes; no more "noise blob" hills). A summary of every NS biome (temperature, downfall, colours, feature names) is in
docs/briefs/naturespirit_biomes.txt; read a few of the source biome/feature JSONs for tree shapes.

Block budget: blocks.json now has exactly 256 blocks (ids are full). New blocks appended for you: redwood/maple/wisteria/palm/cypress/aspen/fir/sugi/
willow/joshua `_log` + `_leaves`, `orange_maple_leaves`, `pink_wisteria_leaves`, `frosty_redwood_leaves`, `lavender`. Everything else in an NS biome
must use existing blocks (terracotta bands for stratified desert, red_sand/red_terracotta for red peaks, white_concrete/quartz_block for white cliffs,
gravel/snow for tundra, sand + palm for tropical shores, etc.).

Deliverables (owned by you: scripts/worldgen/**, data/biomes.json additions via a new `tools/convert_naturespirit.py` that APPENDS/updates NS biomes
in data/biomes.json and adds them to the earth planet's biome list in data/planets.json — idempotent, keyed by biome id, run after
convert_dmz_data_b.py; document that order at the top of both files):
1. Earth biome set = the existing 24 + these NS biomes (map each to our blocks/trees/plants/colours from naturespirit_biomes.txt): alpine_clearings,
   alpine_highlands, arid_savanna, aspen_forest, bamboo_wetlands (use sugar_cane/tall_grass), blooming_dunes, boreal_taiga (fir), carnation_fields
   (flowers), cedar_thicket (-> fir/cypress mix), chaparral, coniferous_covert, cypress_fields, drylands, dusty_slopes, fir_forest, floral_ridges,
   golden_wilds (aspen/yellow), heather_fields, lavender_fields (lavender!), lively_dunes, maple_woodlands (red + orange maples), marigold_meadows,
   marsh, oak_savanna, prairie, red_peaks, redwood_forest (giant redwoods 30-50 tall), scorched_dunes, shrubland, sleeted_slopes, snowcapped_red_peaks,
   snowy_fir_forest, snowy_redwood_forest (frosty leaves), sparse_tropical_woods, stratified_desert (terracotta bands + pillars), sugi_forest,
   tropical_basin, tropical_shores (palms), tropical_woods, tundra, white_cliffs, windswept_sugi_forest, wisteria_forest (purple+pink), wooded_drylands,
   woody_highlands, xeric_plains (joshua trees). Keep `quest_tag`s of the original quest biomes intact.
2. Terrain rework for Earth: continentalness/erosion/peaks-valleys spline terrain (Minecraft 1.18-style density with a height spline) with
   `ridged` mountain noise for ranges (peaks 110-127 with snow above 100, stone above 90), river carving (a river noise band that cuts the surface to
   sea level - 2 with sand/gravel banks), cliffs (erosion low + steep gradient → exposed stone walls), plateaus (terraced erosion), large lakes,
   beaches. Biome placement by temperature/humidity/continentalness/erosion/weirdness like vanilla, with NS biomes filling the appropriate cells
   (cold+mountain = alpine/snowcapped; hot+dry = drylands/dunes/stratified desert; temperate+wet = maple/wisteria/redwood; etc.). Keep spawn in a
   friendly biome with the Saiyan-saga wasteland within 400 blocks.
3. Trees: shapes from NS features — giant redwood (2x2 trunk, tall conical canopy), maple (round canopy), wisteria (drooping leaves 2-3 below the
   canopy edge, using the leaves), palm (curved trunk + fan), cypress (tall thin cone), aspen (tall thin, small round crown), fir (conical, snow variant),
   sugi (tall, layered), willow (wide, hanging), joshua (branching). Plants: lavender fields, flowers, dead bushes, cacti in dunes.
4. Column generation must stay under ~10 ms on desktop; profile and report.
5. Tests: NS biome ids present and valid, terrain heights within [1,127], rivers reach sea level, mountains exceed 100 somewhere within 1500 blocks
   of spawn (deterministic seed), each NS tree type generates without exceptions.
6. Screenshots: `--autoplay=<seed> --planet=earth` at several seeds/positions (add a `--pos=x,z` arg to Main if not present — it belongs to the
   integrator; use `--autoplay` seeds that put spawn in different biomes instead) — LOOK at them: mountains, rivers, a maple/wisteria/redwood forest,
   a desert with stratified bands. Report with paths.
