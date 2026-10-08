# Reference data provenance

These files are verbatim copies of Mojang's official metadata, used by the validators in `tools/`.

| File | Source |
|---|---|
| `mojang-commands.json` | `Mojang/bedrock-samples` tag `v1.26.50.4` (commit `46ba6ea985fb5a92d79a9419198f10dda14c199d`), `metadata/command_modules/` |
| `mojang-blocks.json`, `mojang-items.json`, `mojang-effects.json`, `mojang-camera-presets.json` | same tag, `metadata/vanilladata_modules/` |

`bedrock-samples` `version.json` lists `1.26.50.4` as the latest stable release (dated 2026-09-15).
Script API typings come from npm: `@minecraft/server@2.10.0`, `@minecraft/server-ui@2.2.0`,
`@minecraft/vanilla-data@1.26.52` (pinned in `../package.json`).
| `vanilla_particles.txt` | identifiers extracted from `resource_pack/particles/*.json` at the same tag |
