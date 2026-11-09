// Natural-play pacing test: a player wanders the caves for N ticks with no admin commands.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = process.env.SIM_DIR;
const mc = await import(pathToFileURL(path.join(simDir, "node_modules/@minecraft/server/index.js")).href);
const { step, fire, addPlayer, log, worldDynamic } = mc;
worldDynamic["shaftbreaker:config"] = JSON.stringify({ graceMinutes: 2, debug: true, territory: false });
const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(" "));
await import(pathToFileURL(path.join(simDir, "scripts/main.js")).href);
const { T } = await import(pathToFileURL(path.join(simDir, "scripts/ai/threat.js")).href);
const pl = addPlayer("Alex", { x: 0.5, y: -24, z: -20.5 });
fire("worldLoad", {}); fire("playerSpawn", { player: pl, initialSpawn: true });
const N = Number(process.env.N || 24000);
const trans = {}; let last = "none"; const timeline = [];
for (let i = 0; i < N; i++) {
  step((t) => {
    // wander along the side cave, looking around; sometimes look back
    const z = -20 - 40 * (0.5 + 0.5 * Math.sin(t / 900));
    pl.teleport({ x: 0.5 + Math.sin(t / 130) * 2, y: -24, z });
    pl._rot = { x: 0, y: (t * 1.3) % 360 };
    const s = T.brain ? T.brain.state : "none";
    if (s !== last) { trans[last + ">" + s] = (trans[last + ">" + s] || 0) + 1; timeline.push(Math.round(t / 20) + "s:" + s); last = s; }
  });
}
console.warn = ow;
console.log("timeline:", timeline.slice(0, 80).join(" "));
console.log("transitions:", JSON.stringify(trans));
const ill = log.sounds.map((s) => s[1]).filter((s) => /knock|whisper|move_far|crawl|scream_far|rumble|dig.stone|step.stone/.test(s));
console.log("illusion-ish sounds:", ill.length, [...new Set(ill)].join(","));
console.log("particles:", [...new Set(log.particles)].join(","));
console.log("errors:", log.errors.length, [...new Set(log.errors)].slice(0, 10));
console.log("warns:", warns.filter((w) => w.includes("Shaftbreaker")).slice(0, 10));
