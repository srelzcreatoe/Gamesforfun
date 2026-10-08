# Reference data provenance

These files are verbatim copies of official (or game-exported) data, used only by the validators and tests in
`tools/` and `tests/`. None of them is shipped inside the packs.

| File | Source |
|---|---|
| `mojang-commands.json` | `Mojang/bedrock-samples` tag `v1.26.50.4` (commit `46ba6ea985fb5a92d79a9419198f10dda14c199d`), `metadata/command_modules/` |
| `mojang-blocks.json`, `mojang-items.json`, `mojang-effects.json`, `mojang-camera-presets.json` | same tag, `metadata/vanilladata_modules/` |
| `vanilla_particles.txt` | identifiers extracted from `resource_pack/particles/*.json` at the same tag |
| `json_schemas/` | same tag, `metadata/json_schemas/` (server/entity, server/item, server/common, client_server/common, client_server/packaging) — used by `tools/validate_schemas.py` |
| `reference_command_blocks.mcstructure` | Bedrock Wiki (`Bedrock-OSS/bedrock-wiki`, commit `a997621c11130076277effe9d387d05fb7794277`), `docs/public/assets/packs/commands/custom-crafting/custom_crafting_example.mcstructure`: a structure exported by Bedrock that contains repeating and chain command blocks. Bedrock Wiki material is licensed CC BY 4.0 / MIT. Used by `tests/structures.test.mjs` as the format reference for command-block NBT (key set, `Version` 42, block version 18161159). |

`bedrock-samples` `version.json` lists `1.26.50.4` as the latest stable release (dated 2026-09-15).
Script API typings come from npm: `@minecraft/server@2.10.0`, `@minecraft/server-ui@2.2.0`,
`@minecraft/vanilla-data@1.26.52` (pinned in `../package.json`).
