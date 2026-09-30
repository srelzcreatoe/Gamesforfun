# Automated behaviour tests (mock API — not a Minecraft playtest)

`mock/` is a small Node.js mock of the stable `@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0 surface the add-on uses
(block map with ray casts, entities with a navigation stand-in, events, dynamic properties, forms). It exercises the real behaviour-pack
scripts; it does not reproduce pathfinding, rendering, latency or chunk loading.

```bash
cd tests
node --import ./mock/loader.mjs mock/selftest.mjs     # harness self-test
node --import ./mock/loader.mjs scenarios.mjs         # 21 scenarios / 102 checks
```

The scenarios import the scripts from `../source/Grinshackle_BP/scripts/` (relative to `tests/`), so keep the folder layout of `source/`.
