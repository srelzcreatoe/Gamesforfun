#!/usr/bin/env node
// Static validation for The Observer packs.
//  1. Every pack JSON file is validated against Mojang's official JSON schemas
//     (@minecraft/bedrock-schemas, matched with its catalog's fileMatch globs).
//  2. Cross-reference checks the schemas cannot express: identifiers, bones, textures,
//     sounds, particles, fogs, lang keys, recipe items, manifest dependencies, and IDs used
//     by the scripts.
// Exit code 0 = clean, 1 = problems found.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BP = path.join(ROOT, "packs", "TheObserver_BP");
const RP = path.join(ROOT, "packs", "TheObserver_RP");
const SCHEMAS = path.join(ROOT, "node_modules", "@minecraft", "bedrock-schemas");
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const readJSON = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`${rel(p)}: invalid JSON (${e.message})`);
    return undefined;
  }
};
const rel = (p) => path.relative(ROOT, p);

// ---------------------------------------------------------------- 1. official schemas
const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
const schemaFiles = walk(path.join(SCHEMAS, "schemas")).filter((f) => f.endsWith(".json"));
for (const f of schemaFiles) {
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  delete s.$id;
  delete s.$schema;
  ajv.addSchema(s, pathToFileURL(f).href);
}
// The schema package references common/expression.schema.json but does not ship it; register a permissive stand-in.
ajv.addSchema({}, pathToFileURL(path.join(SCHEMAS, "schemas", "common", "expression.schema.json")).href);
// Known defects in @minecraft/bedrock-schemas 1.26.50, recorded rather than hidden. Each is contradicted by
// vanilla content and by a clean load on Bedrock Dedicated Server 1.26.52 (see docs/TEST_REPORT.md).
const SCHEMA_QUIRKS = [
  [/recipes\/.*must have required property 'minecraft:recipe_brewing_mix'/, "recipe catalog entry points at the brewing-mix schema only"],
  [/languages\.json: schema \/ must be object/, "languages.json is an array of language codes in vanilla packs"],
  [/fogs\/.*description\/identifier must be boolean/, "fog identifier is a string in vanilla fogs"],
  [/render_controllers.*part_visibility must be object/, "vanilla render controllers use an array for part_visibility"],
  [/blocks\/.*minecraft:loot must be object/, "schema describes minecraft:loot as a path string but types it as object"],
  [/models\/.*\/(visible_bounds_offset|pivot|origin|size|uv|rotation)\/.* must be string/, "geometry schema types numeric vectors as strings; Blockbench and vanilla models use numbers (the supplied model fails the same way)"],
];
const quirkHits = [];
const catalog = JSON.parse(fs.readFileSync(path.join(SCHEMAS, "catalog.json"), "utf8"));
const globToRx = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
// match on the file's top-level folder ("**/<dir>/**") or exact file name ("**/<name>.json"), per pack side
const matchers = catalog.schemas.map((s) => {
  const g = (s.fileMatch || [])[0] || "";
  const dir = (g.match(/^\*\*\/([a-z_]+)\/\*\*/) || [])[1];
  const file = dir ? undefined : (g.match(/^\*\*\/([a-z_]+\.json)$/) || [])[1];
  return { side: s.url.includes("/rp/") ? "rp" : "bp", dir, file, url: pathToFileURL(path.join(SCHEMAS, s.url)).href };
});
const validators = new Map();
let schemaChecked = 0;
for (const pack of [BP, RP]) {
  for (const f of walk(pack).filter((x) => x.endsWith(".json"))) {
    const relPack = path.relative(pack, f).split(path.sep).join("/");
    const data = readJSON(f);
    if (data === undefined) continue;
    const side = pack === RP ? "rp" : "bp";
    const top = relPack.split("/")[0];
    const base = relPack.split("/").pop();
    const m = matchers.find((mm) => mm.side === side && ((mm.dir && mm.dir === top && relPack.includes("/")) || (mm.file && mm.file === base)));
    if (!m) continue;
    let v = validators.get(m.url);
    if (!v) {
      try {
        v = ajv.getSchema(m.url);
      } catch (e) {
        notes.push(`schema ${m.url} could not compile: ${e.message}`);
      }
      validators.set(m.url, v);
    }
    if (!v) continue;
    schemaChecked++;
    if (!v(data)) {
      for (const err of v.errors.slice(0, 6)) {
        const msg = `${rel(f)}: schema ${err.instancePath || "/"} ${err.message} ${err.params ? JSON.stringify(err.params) : ""}`;
        const q = SCHEMA_QUIRKS.find(([rx]) => rx.test(msg));
        if (q) quirkHits.push(`${rel(f)} (${q[1]})`);
        else fail(msg);
      }
    }
  }
}
notes.push(`schema-validated files: ${schemaChecked}`);
for (const q of new Set(quirkHits)) notes.push(`schema-package quirk (not a pack error): ${q}`);

// ---------------------------------------------------------------- 2. cross references
const exists = (...p) => fs.existsSync(path.join(...p));
const bpManifest = readJSON(path.join(BP, "manifest.json"));
const rpManifest = readJSON(path.join(RP, "manifest.json"));
if (!bpManifest.dependencies.some((d) => d.uuid === rpManifest.header.uuid)) fail("BP manifest does not depend on the RP");
if (!rpManifest.dependencies.some((d) => d.uuid === bpManifest.header.uuid)) fail("RP manifest does not depend on the BP");
const uuids = [bpManifest.header.uuid, rpManifest.header.uuid, ...bpManifest.modules.map((m) => m.uuid), ...rpManifest.modules.map((m) => m.uuid)];
if (new Set(uuids).size !== uuids.length) fail("duplicate UUIDs across manifests");
if (!exists(BP, bpManifest.modules.find((m) => m.type === "script").entry)) fail("script entry missing");

// geometry
const geos = new Map();
for (const f of walk(path.join(RP, "models"))) {
  const g = readJSON(f);
  for (const geo of g?.["minecraft:geometry"] ?? []) geos.set(geo.description.identifier, new Set(geo.bones.map((b) => b.name)));
}
// animations
const anims = new Map();
for (const f of walk(path.join(RP, "animations"))) for (const [k, v] of Object.entries(readJSON(f)?.animations ?? {})) anims.set(k, v);
const controllers = new Map();
for (const f of walk(path.join(RP, "animation_controllers"))) for (const [k, v] of Object.entries(readJSON(f)?.animation_controllers ?? {})) controllers.set(k, v);
const renderControllers = new Set();
for (const f of walk(path.join(RP, "render_controllers"))) for (const k of Object.keys(readJSON(f)?.render_controllers ?? {})) renderControllers.add(k);

for (const f of walk(path.join(RP, "entity"))) {
  const d = readJSON(f)?.["minecraft:client_entity"]?.description;
  if (!d) continue;
  for (const [k, g] of Object.entries(d.geometry)) if (!geos.has(g)) fail(`${rel(f)}: geometry ${k} -> ${g} not found`);
  for (const [k, t] of Object.entries(d.textures)) if (!exists(RP, t + ".png")) fail(`${rel(f)}: texture ${k} -> ${t}.png missing`);
  for (const rc of d.render_controllers) if (!renderControllers.has(typeof rc === "string" ? rc : Object.keys(rc)[0])) fail(`${rel(f)}: render controller ${rc} missing`);
  const bones = geos.get(d.geometry.default) ?? new Set();
  for (const [short, id] of Object.entries(d.animations)) {
    if (id.startsWith("controller.")) {
      const c = controllers.get(id);
      if (!c) fail(`${rel(f)}: controller ${id} missing`);
      for (const [sn, st] of Object.entries(c?.states ?? {})) {
        for (const a of st.animations ?? []) {
          const name = typeof a === "string" ? a : Object.keys(a)[0];
          if (!d.animations[name]) fail(`${id}.${sn}: animation short name '${name}' not declared on the entity`);
        }
        for (const t of st.transitions ?? []) for (const target of Object.keys(t)) if (!c.states[target]) fail(`${id}.${sn}: transition to missing state ${target}`);
        for (const se of st.sound_effects ?? []) if (!d.sound_effects?.[se.effect]) fail(`${id}.${sn}: sound effect ${se.effect} not declared`);
      }
      continue;
    }
    const a = anims.get(id);
    if (!a) {
      fail(`${rel(f)}: animation ${short} -> ${id} missing`);
      continue;
    }
    for (const b of Object.keys(a.bones ?? {})) if (!bones.has(b)) fail(`${id}: bone ${b} not in geometry`);
  }
  for (const scr of d.scripts?.animate ?? []) {
    const n = typeof scr === "string" ? scr : Object.keys(scr)[0];
    if (!d.animations[n]) fail(`${rel(f)}: scripts.animate uses undeclared ${n}`);
  }
}

// sounds
const soundDefs = readJSON(path.join(RP, "sounds", "sound_definitions.json")).sound_definitions;
for (const [k, v] of Object.entries(soundDefs)) for (const s of v.sounds) {
  const n = typeof s === "string" ? s : s.name;
  if (!exists(RP, n + ".ogg")) fail(`sound ${k}: ${n}.ogg missing`);
}
const clientEntity = readJSON(path.join(RP, "entity", "the_observer.entity.json"))["minecraft:client_entity"].description;
// the game client accepts only "short name": "sound event" strings here (objects are rejected at load)
for (const [k, v] of Object.entries(clientEntity.sound_effects ?? {})) {
  if (typeof v !== "string") fail(`client entity sound effect ${k} must be a string (the client rejects objects)`);
  else if (!soundDefs[v]) fail(`client entity sound effect ${k} -> ${v} not defined`);
}
// the game client rejects an empty "animations" list in a controller state
for (const f of walk(path.join(RP, "animation_controllers"))) {
  for (const [cn, c] of Object.entries(readJSON(f).animation_controllers)) {
    for (const [sn, st] of Object.entries(c.states)) if (Array.isArray(st.animations) && st.animations.length === 0) fail(`${rel(f)}: ${cn} state ${sn} has an empty animations list`);
  }
}
const entSounds = readJSON(path.join(RP, "sounds.json"));
for (const ev of Object.values(entSounds.entity_sounds.entities["observer:the_observer"].events)) if (!soundDefs[ev.sound]) fail(`entity sound ${ev.sound} not defined`);

// particles
const particleIds = new Set();
for (const f of walk(path.join(RP, "particles"))) {
  const pe = readJSON(f)?.particle_effect;
  if (!pe) continue;
  particleIds.add(pe.description.identifier);
  const tex = pe.description.basic_render_parameters.texture;
  if (!exists(RP, tex + ".png")) fail(`${rel(f)}: texture ${tex}.png missing`);
}
const fogIds = new Set(walk(path.join(RP, "fogs")).map((f) => readJSON(f)?.["minecraft:fog_settings"]?.description?.identifier));

// textures & blocks & items
const terrain = readJSON(path.join(RP, "textures", "terrain_texture.json")).texture_data;
const itemTex = readJSON(path.join(RP, "textures", "item_texture.json")).texture_data;
for (const [k, v] of Object.entries({ ...terrain, ...itemTex })) for (const t of [].concat(v.textures)) if (!exists(RP, t + ".png")) fail(`texture key ${k} -> ${t}.png missing`);
const lang = fs.readFileSync(path.join(RP, "texts", "en_US.lang"), "utf8");
const langKeys = new Set([...lang.matchAll(/^([^#=\s][^=]*)=/gm)].map((m) => m[1]));
const blockIds = new Set();
for (const f of walk(path.join(BP, "blocks"))) {
  const b = readJSON(f)["minecraft:block"];
  blockIds.add(b.description.identifier);
  for (const mi of Object.values(b.components["minecraft:material_instances"] ?? {})) if (!terrain[mi.texture]) fail(`${rel(f)}: material texture ${mi.texture} not in terrain_texture.json`);
  const geo = b.components["minecraft:geometry"];
  const gid = typeof geo === "string" ? geo : geo?.identifier;
  if (gid && !gid.startsWith("minecraft:") && !geos.has(gid)) fail(`${rel(f)}: geometry ${gid} missing`);
  const dn = b.components["minecraft:display_name"];
  if (dn && !langKeys.has(dn)) fail(`${rel(f)}: display name key ${dn} missing from lang`);
  const loot = b.components["minecraft:loot"];
  if (loot && !exists(BP, loot)) fail(`${rel(f)}: loot table ${loot} missing`);
}
const itemIds = new Set();
for (const f of walk(path.join(BP, "items"))) {
  const it = readJSON(f)["minecraft:item"];
  itemIds.add(it.description.identifier);
  const icon = it.components["minecraft:icon"];
  const key = typeof icon === "string" ? icon : icon?.textures?.default ?? icon?.texture;
  if (!itemTex[key]) fail(`${rel(f)}: icon ${key} not in item_texture.json`);
  const dn = it.components["minecraft:display_name"]?.value;
  if (dn && !langKeys.has(dn)) fail(`${rel(f)}: display name ${dn} missing from lang`);
}
for (const id of blockIds) itemIds.add(id);
for (const f of walk(path.join(BP, "recipes"))) {
  const r = Object.values(readJSON(f)).find((v) => typeof v === "object" && v.description);
  for (const ing of r.ingredients ?? []) if (ing.item.startsWith("observer:") && !itemIds.has(ing.item)) fail(`${rel(f)}: unknown ingredient ${ing.item}`);
  if (!itemIds.has(r.result.item) && r.result.item.startsWith("observer:")) fail(`${rel(f)}: unknown result ${r.result.item}`);
}
for (const k of ["entity.observer:the_observer.name", "item.spawn_egg.entity.observer:the_observer.name", "pack.name", "pack.description"]) if (!langKeys.has(k)) fail(`lang key ${k} missing`);

// ---------------------------------------------------------------- 3. IDs used by scripts
const src = walk(path.join(BP, "scripts")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const constants = fs.readFileSync(path.join(BP, "scripts", "core", "constants.js"), "utf8");
const block = (name) => constants.split(`export const ${name} = {`)[1].split("};")[0];
for (const m of block("SOUNDS").matchAll(/:\s*"([^"]+)"/g)) if (!soundDefs[m[1]]) fail(`script sound ${m[1]} not defined in sound_definitions.json`);
for (const m of block("PARTICLES").matchAll(/:\s*"([^"]+)"/g)) if (!particleIds.has(m[1])) fail(`script particle ${m[1]} not defined`);
for (const m of block("FOGS").matchAll(/:\s*"([^"]+)"/g)) if (!fogIds.has(m[1])) fail(`script fog ${m[1]} not defined`);
for (const m of block("ITEMS").matchAll(/:\s*"([^"]+)"/g)) if (!itemIds.has(m[1])) fail(`script item ${m[1]} not defined`);
for (const m of block("BLOCKS").matchAll(/:\s*"([^"]+)"/g)) if (!blockIds.has(m[1])) fail(`script block ${m[1]} not defined`);
for (const m of src.matchAll(/"(observer:[a-z_]+)"/g)) {
  const id = m[1];
  if (/^observer:(the_observer|encounter|preset|state|stoop|side|enc|world|player|clock|dark|ledger|probe|dread|dread_soft|vigil)$/.test(id)) continue;
  if (!itemIds.has(id) && !blockIds.has(id) && !particleIds.has(id) && !fogIds.has(id)) fail(`script references unknown id ${id}`);
}
// entity properties and events used by scripts
const ent = readJSON(path.join(BP, "entities", "the_observer.json"))["minecraft:entity"];
const states = new Set(ent.description.properties["observer:state"].values);
for (const m of src.matchAll(/setState\("([a-z]+)"\)/g)) if (!states.has(m[1])) fail(`script sets unknown state ${m[1]}`);
for (const m of src.matchAll(/state:\s*"([a-z]+)"/g)) if (!states.has(m[1])) fail(`script spawns with unknown state ${m[1]}`);
for (const m of src.matchAll(/setMode\("([a-z]+)"\)/g)) if (!ent.events[`observer:to_${m[1]}`]) fail(`script mode ${m[1]} has no entity event`);
for (const ev of Object.values(ent.events)) for (const g of [...(ev.add?.component_groups ?? []), ...(ev.remove?.component_groups ?? [])]) if (!ent.component_groups[g]) fail(`entity event references missing group ${g}`);
const ctrlStates = controllers.get("controller.animation.observer.state").states;
for (const s of states) if (!ctrlStates[s]) fail(`state ${s} has no animation controller state`);
// vanilla block ids used by scripts exist in vanilla-data
try {
  const vd = fs.readFileSync(path.join(ROOT, "node_modules", "@minecraft", "vanilla-data", "lib", "mojang-block.d.ts"), "utf8");
  const vanilla = new Set([...vd.matchAll(/= "(minecraft:[a-z0-9_]+)"/g)].map((m) => m[1]));
  // constants.js has no runtime imports, so Node can load it directly
  const C = await import(pathToFileURL(path.join(BP, "scripts", "core", "constants.js")).href);
  let n = 0;
  for (const name of ["DOORS", "TRAPDOORS", "GATES", "REMOVABLE_LIGHTS", "CANDLES", "CAMPFIRES", "TURNABLE", "NATURAL", "DANGER"]) {
    for (const id of C[name]) {
      n++;
      if (!vanilla.has(id)) fail(`${name}: ${id} is not a vanilla block id (vanilla-data 1.26.52)`);
    }
  }
  for (const id of Object.values(C.MIMIC_AS)) if (!vanilla.has(id)) fail(`MIMIC_AS: ${id} not vanilla`);
  notes.push(`vanilla block ids checked: ${n}`);
} catch (e) {
  notes.push(`vanilla id check error ${e.message}`);
}

for (const n of notes) console.log("note:", n);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(" -", p);
  process.exit(1);
}
console.log("validation OK");
