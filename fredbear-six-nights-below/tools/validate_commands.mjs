// Validates command strings against Mojang's official 1.26.50 command
// metadata (tools/ref/mojang-commands.json): command name, overload shape,
// parameter types and enum values. Extra semantic checks: block names and
// block-state arrays (mojang-blocks.json), particle ids, sound ids defined by
// our resource pack, function paths, fill volume limit and world height.
import fs from 'node:fs';
import path from 'node:path';
import { loadBlockMeta, checkBlock } from './validate_blocks.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ref/mojang-commands.json')));
const ENUMS = Object.fromEntries(META.command_enums.map((e) => [e.name.toUpperCase(), new Set(e.values.map((v) => (typeof v === 'object' ? v.value : v)))]));
const COMMANDS = new Map();
for (const c of META.commands) {
  COMMANDS.set(c.name, c);
  for (const a of c.aliases ?? []) COMMANDS.set(typeof a === 'object' ? a.value ?? a.name : a, c);
}
const PARTICLES = new Set(fs.readFileSync(path.join(ROOT, 'tools/ref/vanilla_particles.txt'), 'utf8').split('\n').filter(Boolean));
const BLOCK_META = loadBlockMeta();

function loadSoundIds() {
  const p = path.join(ROOT, 'packs/FredbearRP/sounds/sound_definitions.json');
  if (!fs.existsSync(p)) return null;
  return new Set(Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).sound_definitions));
}
function loadFunctions() {
  const dir = path.join(ROOT, 'packs/FredbearBP/functions');
  const out = new Set();
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else if (f.name.endsWith('.mcfunction')) out.add(path.relative(dir, path.join(d, f.name)).replace(/\.mcfunction$/, '').split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

export function tokenize(cmd) {
  const out = [];
  let i = 0;
  while (i < cmd.length) {
    if (cmd[i] === ' ') {
      i++;
      continue;
    }
    let j = i;
    if (cmd[i] === '"') {
      j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') j += cmd[j] === '\\' ? 2 : 1;
      out.push(cmd.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let depth = 0;
    while (j < cmd.length && (depth > 0 || cmd[j] !== ' ')) {
      if (cmd[j] === '[' || cmd[j] === '{') depth++;
      else if (cmd[j] === ']' || cmd[j] === '}') depth--;
      else if (cmd[j] === '"') {
        j++;
        while (j < cmd.length && cmd[j] !== '"') j++;
      }
      j++;
    }
    out.push(cmd.slice(i, j));
    i = j;
  }
  return out;
}

const NUM = /^-?(\d+\.?\d*|\.\d+)$/;
const REL = /^[~^](-?(\d+\.?\d*|\.\d+))?$/;
const isCoord = (t) => NUM.test(t) || REL.test(t);
const isSelector = (t) => /^@(a|e|p|r|s|n|initiator)(\[.*\])?$/.test(t) || /^"[^"]+"$/.test(t) || /^[A-Za-z][\w]*$/.test(t);

/** Try to consume tokens for one parameter type. Returns tokens consumed, or -1. */
function matchParam(type, toks, k, ctx) {
  const t = toks[k];
  const T = type.toUpperCase();
  switch (T) {
    case 'POSITION':
    case 'POSITION_FLOAT':
      if (k + 2 < toks.length && isCoord(toks[k]) && isCoord(toks[k + 1]) && isCoord(toks[k + 2])) {
        ctx.positions.push(toks.slice(k, k + 3));
        return 3;
      }
      return -1;
    case 'MESSAGE_ROOT':
      return toks.length - k >= 1 ? toks.length - k : -1;
  }
  if (t === undefined) return -1;
  switch (T) {
    case 'SELECTION':
      return isSelector(t) ? 1 : -1;
    case 'WILDCARDSELECTION':
      return t === '*' || isSelector(t) ? 1 : -1;
    case 'INT':
    case 'WILDCARDINT':
      return /^-?\d+$/.test(t) || (T === 'WILDCARDINT' && t === '*') ? 1 : -1;
    case 'VAL':
      return NUM.test(t) ? 1 : -1;
    case 'RVAL':
      return NUM.test(t) || REL.test(t) ? 1 : -1;
    case 'BOOLEAN':
      return t === 'true' || t === 'false' ? 1 : -1;
    case 'BLOCK': {
      const name = t.startsWith('minecraft:') ? t : `minecraft:${t}`;
      if (!ENUMS.BLOCK.has(t) && !BLOCK_META.blocks[name]) return -1;
      ctx.blocks.push(name);
      return 1;
    }
    case 'BLOCK_STATE_ARRAY':
      if (!/^\[.*\]$/.test(t)) return -1;
      ctx.states.push(t);
      return 1;
    case 'ITEM':
      return ENUMS.ITEM.has(t) || t.startsWith('fb:') ? 1 : -1;
    case 'ENTITYTYPE':
      return ENUMS.ENTITYTYPE.has(t) || t.startsWith('fb:') ? 1 : -1;
    case 'JSON_OBJECT':
      if (!/^\{.*\}$/.test(t)) return -1;
      try {
        JSON.parse(t);
        return 1;
      } catch {
        return -1;
      }
    case 'ID':
    case 'PATHCOMMAND':
      ctx.ids.push(t);
      return /^[\w:./\-]+$/.test(t) ? 1 : -1;
    default: {
      const e = ENUMS[T];
      if (e) return e.has(t) ? 1 : -1;
      ctx.unchecked.add(T);
      return 1;
    }
  }
}

function matchOverload(params, toks, i, ctx) {
  if (params.length === 0) return i === toks.length;
  const [p, ...rest] = params;
  if (i === toks.length) return p.is_optional && rest.every((r) => r.is_optional);
  const snapshot = JSON.stringify({ positions: ctx.positions, blocks: ctx.blocks, states: ctx.states, ids: ctx.ids });
  const n = matchParam(p.type.name, toks, i, ctx);
  if (n > 0 && matchOverload(rest, toks, i + n, ctx)) return true;
  Object.assign(ctx, JSON.parse(snapshot));
  if (p.is_optional && rest.every((r) => r.is_optional)) return false;
  return false;
}

let SOUNDS;
let FUNCTIONS;
/** Validate one command. Returns an array of error strings (empty = OK). */
export function validateCommand(command, { scriptEvents } = {}) {
  SOUNDS ??= loadSoundIds();
  FUNCTIONS ??= loadFunctions();
  const errs = [];
  const toks = tokenize(command.replace(/^\//, ''));
  const name = toks[0];
  const def = COMMANDS.get(name);
  if (!def) return [`unknown command '${name}'`];
  let matched = null;
  for (const ov of def.overloads) {
    const ctx = { positions: [], blocks: [], states: [], ids: [], unchecked: new Set() };
    if (matchOverload(ov.params, toks, 1, ctx)) {
      matched = { ov, ctx };
      break;
    }
  }
  if (!matched) return [`no overload of '${name}' matches: ${command}`];
  const { ctx } = matched;
  if (ctx.unchecked.size) errs.push(`uses parameter types the validator cannot check: ${[...ctx.unchecked].join(', ')}`);
  // Semantic checks.
  for (const pos of ctx.positions) {
    const y = Number(pos[1]);
    if (NUM.test(pos[1]) && (y < -64 || y > 319)) errs.push(`y ${y} outside world height`);
  }
  if (name === 'fill' && ctx.positions.length >= 2 && ctx.positions.flat().every((v) => NUM.test(v))) {
    const [a, b] = ctx.positions;
    const vol = (Math.abs(a[0] - b[0]) + 1) * (Math.abs(a[1] - b[1]) + 1) * (Math.abs(a[2] - b[2]) + 1);
    if (vol > 32768) errs.push(`fill volume ${vol} exceeds 32768`);
  }
  if (ctx.states.length) {
    const blockName = ctx.blocks[0];
    for (const st of ctx.states.slice(0, 1)) {
      const states = {};
      for (const kv of st.slice(1, -1).split(',').filter(Boolean)) {
        const [k, v] = kv.split('=');
        const key = JSON.parse(k);
        states[key] = v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : JSON.parse(v);
      }
      errs.push(...checkBlock(BLOCK_META, blockName, states));
    }
  }
  if (name === 'playsound' && SOUNDS) {
    const id = toks[1];
    if (id.startsWith('fb.') && !SOUNDS.has(id)) errs.push(`sound '${id}' is not defined in FredbearRP sound_definitions.json`);
  }
  if (name === 'particle' && !PARTICLES.has(toks[1])) errs.push(`unknown particle '${toks[1]}'`);
  if (name === 'function' && !FUNCTIONS.has(toks[1])) errs.push(`function '${toks[1]}' not found in FredbearBP/functions`);
  if (name === 'scriptevent') {
    if (!/^[a-z0-9_]+:[a-z0-9_.]+$/.test(toks[1]) || toks[1].startsWith('minecraft:')) errs.push(`bad scriptevent id ${toks[1]}`);
    if (scriptEvents && toks[1] === 'fb:input' && !scriptEvents(toks.slice(2).join(' '))) errs.push(`scriptevent fb:input '${toks.slice(2).join(' ')}' has no handler`);
  }
  return errs;
}

export async function validateAllCommands({ quiet = false } = {}) {
  const { allCommandBlocks } = await import('./gen_structures.mjs');
  const { isKnownInputAction } = await import('../packs/FredbearBP/scripts/data/input_actions.js');
  const results = [];
  for (const b of allCommandBlocks()) results.push({ where: `CB ${b.id} @ ${b.world.join(' ')}`, command: b.command });
  const fnDir = path.join(ROOT, 'packs/FredbearBP/functions');
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.mcfunction')) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, n) => {
          const l = line.trim();
          if (l && !l.startsWith('#')) results.push({ where: `${path.relative(ROOT, p)}:${n + 1}`, command: l });
        });
      }
    }
  };
  walk(fnDir);
  try {
    const { COMMAND_TEMPLATES } = await import('../packs/FredbearBP/scripts/mc/commands.js');
    for (const [k, v] of Object.entries(COMMAND_TEMPLATES)) for (const c of [].concat(v)) results.push({ where: `script template ${k}`, command: c });
  } catch (e) {
    if (!String(e).includes('Cannot find module')) throw e;
  }
  let bad = 0;
  for (const r of results) {
    r.errors = validateCommand(r.command, { scriptEvents: isKnownInputAction });
    if (r.errors.length) {
      bad++;
      if (!quiet) console.log(`ERROR ${r.where}: ${r.command}\n      ${r.errors.join('\n      ')}`);
    }
  }
  if (!quiet) console.log(`${results.length} commands checked against 1.26.50 metadata: ${bad ? `${bad} with errors` : 'all valid'}`);
  return { total: results.length, bad, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await validateAllCommands();
  process.exit(r.bad ? 1 : 0);
}
