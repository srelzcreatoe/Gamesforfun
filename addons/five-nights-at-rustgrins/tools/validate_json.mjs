// Validates pack JSON files against Mojang's official @minecraft/bedrock-schemas.
// Usage: node tools/validate_json.mjs [file-or-dir ...]   (default: packs/)
// Files are matched to schemas with the package's catalog.json globs. Files with
// no matching schema are only parsed. Exit code 1 on any error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCHEMAS = path.join(HERE, 'node_modules/@minecraft/bedrock-schemas');
const catalog = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'catalog.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, loadSchema: undefined });
addFormats(ajv);
// Register every schema file under its relative path so $refs resolve.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}
const compiled = new Map();
function getValidator(schemaPath) {
  if (compiled.has(schemaPath)) return compiled.get(schemaPath);
  let v = null;
  try {
    const abs = path.join(SCHEMAS, schemaPath);
    const base = 'file://' + abs;
    const load = (file) => {
      const id = 'file://' + file;
      if (ajv.getSchema(id)) return;
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete s.$id;
      ajv.addSchema(s, id);
    };
    // Preload sibling schemas of the same folder tree (refs are relative).
    for (const f of walk(path.dirname(abs))) load(f);
    for (const f of walk(path.join(SCHEMAS, 'schemas/common'))) load(f);
    // The package references a few schema files it does not ship: stub them as permissive.
    for (const f of walk(path.dirname(abs))) {
      const txt = fs.readFileSync(f, 'utf8');
      for (const m of txt.matchAll(/"\$ref"\s*:\s*"([^"#]+)/g)) {
        const target = path.resolve(path.dirname(f), m[1]);
        const id = 'file://' + target;
        if (!fs.existsSync(target) && !ajv.getSchema(id)) ajv.addSchema({}, id);
      }
    }
    v = ajv.getSchema(base);
  } catch (e) {
    console.warn(`schema ${schemaPath}: ${e.message}`);
  }
  compiled.set(schemaPath, v);
  return v;
}

function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (g.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; }
    else if (g.startsWith('**', i)) { re += '.*'; i += 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^(?:.*/)?' + re.replace(/^\(\?:\.\*\/\)\?/, '') + '$');
}
const rules = catalog.schemas.map((s) => ({ name: s.name, res: s.fileMatch.map(globToRe), url: s.url.replace(/^\.\//, '') }));

function schemaFor(rel) {
  const r = rel.split(path.sep).join('/');
  // Resource pack vs behavior pack disambiguation for shared folder names.
  const inRP = /(^|\/)[^/]*RP\//.test(r);
  for (const rule of rules) {
    if (!rule.res.some((re) => re.test(r))) continue;
    if (inRP && rule.url.startsWith('schemas/bp/') && !/manifest/.test(rule.url)) continue;
    if (!inRP && rule.url.startsWith('schemas/rp/')) continue;
    return rule;
  }
  return null;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(ROOT, 'packs')];
const files = [];
for (const t of targets) {
  const abs = path.resolve(t);
  if (fs.statSync(abs).isDirectory()) files.push(...walk(abs)); else files.push(abs);
}
// Known false positives in @minecraft/bedrock-schemas 1.26.50 (vanilla content itself uses these forms).
const KNOWN = [
  [/fogs\//, /\/description\/identifier$/, /must be boolean/],
  [/render_controllers\//, /\/part_visibility$/, /must be object/],
  [/languages\.json$/, /^$/, /must be object/],
  [/(item|terrain)_texture\.json$/, /\/textures$/, /must be array/],
];
const known = (rel, e) => KNOWN.some(([f, p, m]) => f.test(rel) && p.test(e.instancePath) && m.test(e.message));
let errors = 0, checked = 0, parsedOnly = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`PARSE ERROR ${rel}: ${e.message}`); errors++; continue; }
  const rule = schemaFor(rel);
  if (!rule) { parsedOnly++; continue; }
  const v = getValidator(rule.url);
  if (!v) { parsedOnly++; continue; }
  checked++;
  if (!v(data)) {
    const real = v.errors.filter((e) => !known(rel, e));
    if (!real.length) continue;
    errors++;
    console.log(`SCHEMA ${rel} (${rule.name}):`);
    for (const e of real.slice(0, 12)) console.log(`   ${e.instancePath || '/'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`);
  }
}
console.log(`validate_json: ${checked} checked against schemas, ${parsedOnly} parsed only, ${errors} with errors`);
process.exit(errors ? 1 : 0);
