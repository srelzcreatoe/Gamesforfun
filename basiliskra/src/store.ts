/**
 * The one world-level record.  The server owns it; everything about Basiliskra's identity,
 * lifecycle and memory lives here and nowhere else, so a restart, a pack upgrade or an
 * interrupted arrival can always be reconciled from it.
 */
import { world } from "@minecraft/server";
import type { V3 } from "./vec";

export const SCHEMA = 2;
const KEY = "bk:rec";
const HARM_KEY = "bk:harm";
const CHUNK = 30000;         // a string dynamic property holds at most 32767 characters

export type Stage =
  | "dormant"     // nothing has happened yet: zero Basiliskras
  | "pending"     // a region crossed the threshold; waiting for a suitable loaded coast
  | "arriving"    // reservation taken: omens, the seam, creation.  Exactly one may ever be reserved
  | "alive"       // he exists (loaded or not) in Form I, II or III
  | "departed";   // he went home.  The encounter is retired for this save: zero Basiliskras, for good

export interface Site { x: number; y: number; z: number; s: string; t: number }

export interface Rec {
  v: number;
  /**
   * The pack's own clock: ticks this world has run with the pack, saved with the record.  Every
   * saved time is measured on it; the engine's tick counter is only good for one session.
   */
  clock: number;
  stage: Stage;
  /** Identity: a random token written on the entity as well, and the engine's persistent entity id. */
  token: string;
  entityId: string | null;
  form: 1 | 2 | 3;
  health: number;
  born: number;
  /** Where the seam opened (and must open again), and the way he faced as he came through. */
  rift: (V3 & { yaw: number }) | null;
  /** The coast whose ruin called him, and who did most of it. */
  origin: V3 | null;
  /** Where he was last brought on purpose (spawn egg, command, config wheel): he keeps to it, and comes back to it. */
  home: V3 | null;
  guilty: string | null;
  guiltyName: string | null;
  beach: V3 | null;
  last: (V3 & { t: number }) | null;
  /** Set by a death we observed; cleared when he comes back through the seam. */
  down: number | null;
  /** A call waiting for water it can be answered in.  `passes` counts complete, fruitless searches round the site. */
  pending: { site: V3; since: number; region: string; passes?: number } | null;
  arrival: { step: number; t0: number; water: V3; yaw: number } | null;
  evolve: { to: 2 | 3; step: number; t0: number; at: V3 | null } | null;
  ending: { step: number; t0: number; tries: number } | null;
  mut: { surfacings: number; episodes: number; overland: number; formSince: number; lastEncounter: number; beams: number };
  learned: {
    bell: V3 | null; bellUses: number; lures: number; lureUntil: number; echoes: Record<string, number>;
    rods: number; fragments: number; fragmentAt: number;
  };
  /** Remembered kills near water: what called, and where. */
  sites: Site[];
  weather: "clear" | "rain" | "thunder";
  /** Fallout: places his light has poisoned, each fading with time (see fallout.ts). Bounded. */
  fallout: { x: number; y: number; z: number; r: number; s: number; t: number; w?: boolean }[];
}

export function freshRecord(): Rec {
  return {
    v: SCHEMA, clock: 0, stage: "dormant", token: "", entityId: null, form: 1, health: 600, born: 0, rift: null, origin: null, home: null,
    guilty: null, guiltyName: null, beach: null, last: null, down: null, pending: null, arrival: null, evolve: null,
    ending: null,
    mut: { surfacings: 0, episodes: 0, overland: 0, formSince: 0, lastEncounter: 0, beams: 0 },
    learned: { bell: null, bellUses: 0, lures: 0, lureUntil: 0, echoes: {}, rods: 0, fragments: 0, fragmentAt: 0 },
    sites: [], weather: "clear", fallout: [],
  };
}

/** Bring a record written by an older pack version up to this one, field by field. */
export function migrate(raw: any): Rec {
  const base = freshRecord();
  if (!raw || typeof raw !== "object") return base;
  const rec: Rec = { ...base, ...raw };
  rec.mut = { ...base.mut, ...(raw.mut ?? {}) };
  rec.learned = { ...base.learned, ...(raw.learned ?? {}) };
  if (!Array.isArray(rec.sites)) rec.sites = [];
  if (!Array.isArray(rec.fallout)) rec.fallout = [];
  if (rec.form !== 1 && rec.form !== 2 && rec.form !== 3) rec.form = 1;
  const stages: Stage[] = ["dormant", "pending", "arriving", "alive", "departed"];
  if (!stages.includes(rec.stage)) rec.stage = rec.entityId ? "alive" : "dormant";
  // v1 kept the retired flag separately
  if (raw.v === 1 && raw.quiet === true) rec.stage = "departed";
  // records from before the pack kept its own clock: start it at the latest time they mention
  if (typeof raw.clock !== "number") {
    rec.clock = Math.max(0, rec.born || 0, rec.mut.formSince || 0, rec.down ?? 0, rec.arrival?.t0 ?? 0, rec.evolve?.t0 ?? 0, rec.last?.t ?? 0, rec.pending?.since ?? 0);
  }
  rec.v = SCHEMA;
  return rec;
}

function readChunks(key: string): string | undefined {
  const head = world.getDynamicProperty(key);
  if (typeof head !== "string") return undefined;
  if (!head.startsWith("#")) return head;
  const n = parseInt(head.slice(1), 10);
  let s = "";
  for (let i = 0; i < n; i++) {
    const part = world.getDynamicProperty(`${key}:${i}`);
    if (typeof part !== "string") return undefined;
    s += part;
  }
  return s;
}

function writeChunks(key: string, s: string): void {
  if (s.length <= CHUNK) { world.setDynamicProperty(key, s); return; }
  const n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) world.setDynamicProperty(`${key}:${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
  world.setDynamicProperty(key, `#${n}`);
}

export class Store {
  rec: Rec = freshRecord();
  harm: any = { regions: {} };
  private dirty = false;
  private harmDirty = false;
  loaded = false;

  load(): void {
    try {
      const s = readChunks(KEY);
      this.rec = migrate(s ? JSON.parse(s) : undefined);
    } catch { this.rec = freshRecord(); }
    try {
      const h = readChunks(HARM_KEY);
      this.harm = h ? JSON.parse(h) : { regions: {} };
      if (!this.harm || typeof this.harm.regions !== "object") this.harm = { regions: {} };
    } catch { this.harm = { regions: {} }; }
    this.loaded = true;
  }

  touch(): void { this.dirty = true; }
  touchHarm(): void { this.harmDirty = true; }

  /** Write now.  Lifecycle transitions call this before they act, never after. */
  save(): void {
    writeChunks(KEY, JSON.stringify(this.rec));
    this.dirty = false;
  }

  flush(): void {
    if (this.dirty) this.save();
    if (this.harmDirty) { writeChunks(HARM_KEY, JSON.stringify(this.harm)); this.harmDirty = false; }
  }
}

export const store = new Store();
/** Now, on the pack's saved clock. */
export const clockNow = (): number => store.rec.clock;

export function newToken(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return s;
}
