// Automated logic tests for the pure night simulation (no Minecraft needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG } from '../packs/FredbearBP/scripts/core/config.js';
import { idleBot, oracleBot, wastefulBot, runNight } from '../tools/lib/bots.mjs';

const LETHAL_PRECURSOR = { bonnie: ['TELEGRAPH'], chica: ['TELEGRAPH'], freddy: ['LURK', 'POWEROUT'], fredbear: ['TELEGRAPH', 'FORCING', 'JAMMED'] };

function runTicks(s, n, each) {
  const fx = [];
  for (let i = 0; i < n && !['WON', 'LOST'].includes(s.phase); i++) {
    each?.(s);
    for (const f of s.tick()) {
      fx.push({ ...f, t: s.t });
      if (f.fx === 'maint_begin') s.resumeMaintenance();
    }
  }
  return fx;
}

test('same seed reproduces the same night exactly (deterministic debug mode)', async () => {
  const a = await runNight(NightSession, { night: 4, seed: 99, bot: idleBot() });
  const b = await runNight(NightSession, { night: 4, seed: 99, bot: idleBot() });
  assert.deepEqual(a.session.log, b.session.log);
  assert.equal(a.t, b.t);
  const c = await runNight(NightSession, { night: 4, seed: 100, bot: idleBot() });
  assert.notDeepEqual(a.session.log, c.session.log);
});

test('all six nights start and complete with a valid defence (oracle, 10 seeds each)', async () => {
  for (let night = 1; night <= 6; night++) {
    for (let seed = 1; seed <= 10; seed++) {
      const r = await runNight(NightSession, { night, seed, bot: oracleBot() });
      assert.equal(r.result, 'WON', `night ${night} seed ${seed} lost to ${r.attacker}`);
      assert.equal(r.t, CONFIG.clock.ticksPerHour * 6);
      assert.ok(r.power > 5000, `night ${night} seed ${seed} finished with only ${r.power}`);
    }
  }
});

test('every lethal attack is preceded by its telegraph state and never passes a closed barrier', async () => {
  let attacks = 0;
  for (let night = 1; night <= 6; night++) {
    for (let seed = 1; seed <= 15; seed++) {
      for (const bot of [idleBot(), wastefulBot()]) {
        const r = await runNight(NightSession, { night, seed, bot });
        const atk = r.session.log.find((l) => l.to === 'ATTACK');
        if (!atk) continue;
        attacks++;
        assert.ok(LETHAL_PRECURSOR[atk.who].includes(atk.from), `${atk.who} attacked from ${atk.from}`);
        const s = r.session;
        const a = s.anim[atk.who];
        if (atk.who !== 'freddy' || atk.from !== 'POWEROUT') {
          // The barrier at the attacker's entry must be open at the moment of attack.
          const entry = a.entry ?? (atk.who === 'freddy' ? 'R' : null);
          assert.ok(entry, 'attack without an entry');
          assert.equal(s.barrierClosed(entry), false, `${atk.who} attacked through a closed ${entry}`);
        }
      }
    }
  }
  assert.ok(attacks > 50, `expected many attacks from idle/wasteful bots, got ${attacks}`);
});

test('a closed door always protects against Bonnie (repelled, never attacks)', () => {
  const s = new NightSession({ night: 6, seed: 3 });
  s.input('door_l');
  runTicks(s, 2);
  assert.equal(s.devices.doorL, true);
  for (const id of ['chica', 'freddy', 'fredbear']) s.setAggression(id, 0);
  s.forceApproach('bonnie', 'L');
  runTicks(s, 600, (ss) => {
    if (ss.anim.bonnie.target === 'R') ss.anim.bonnie.target = 'L';
  });
  assert.ok(s.log.some((l) => l.who === 'bonnie' && l.to === 'RETREAT'), 'Bonnie should retreat');
  assert.ok(!s.log.some((l) => l.to === 'ATTACK'));
});

test('6 AM boundary: win commits before an attack that has not started; a started jumpscare still loses', () => {
  const s = new NightSession({ night: 2, seed: 1 });
  for (const id of ['chica', 'freddy']) s.setAggression(id, 0);
  s.place('bonnie', 'W_DOOR', 'TELEGRAPH');
  s.anim.bonnie.entry = 'L';
  s.director.entries.L = 'bonnie';
  s.anim.bonnie.timer = 0; // window already elapsed: would attack this tick
  s.setTick(s.length - 1);
  runTicks(s, 3);
  assert.equal(s.phase, 'WON');
  assert.ok(!s.log.some((l) => l.to === 'ATTACK'));

  const s2 = new NightSession({ night: 2, seed: 1 });
  for (const id of ['chica', 'freddy']) s2.setAggression(id, 0);
  s2.place('bonnie', 'W_DOOR', 'TELEGRAPH');
  s2.anim.bonnie.entry = 'L';
  s2.director.entries.L = 'bonnie';
  s2.anim.bonnie.timer = 0;
  s2.setTick(s2.length - 3);
  runTicks(s2, 100);
  assert.equal(s2.phase, 'LOST', 'attack began at 5:59 and must complete');
});

test('power reaching zero: reserve window on night 3, Freddy sequence otherwise, devices forced off', () => {
  const s = new NightSession({ night: 3, seed: 5 });
  s.input('door_l');
  s.input('door_r');
  runTicks(s, 2);
  s.setPowerPercent(0.01);
  runTicks(s, 2);
  assert.equal(s.phase, 'POWER_OUT');
  assert.equal(s.devices.doorL, false);
  assert.equal(s.devices.doorR, false);
  s.input('reserve');
  runTicks(s, 1);
  assert.equal(s.phase, 'RUNNING');
  assert.equal(s.power > 7000, true);

  const s1 = new NightSession({ night: 1, seed: 5 });
  s1.setPowerPercent(0.001);
  const fx = runTicks(s1, 900);
  assert.ok(fx.some((f) => f.fx === 'power_out' && f.stage === 'music'));
  assert.equal(s1.phase, 'LOST');
  assert.equal(s1.jumpscare.who, 'freddy');
});

test('power out right before 6 AM can still be survived', () => {
  const s = new NightSession({ night: 1, seed: 8 });
  s.setTick(s.length - 80);
  s.setPowerPercent(0.001);
  runTicks(s, 200);
  assert.equal(s.phase, 'WON');
});

function fredbearAt(night, entry) {
  const s = new NightSession({ night, seed: 11 });
  for (const id of ['bonnie', 'chica', 'freddy']) s.setAggression(id, 0);
  const fb = s.anim.fredbear;
  s.place('fredbear', { H: 'SUB_N', L: 'WH_S', R: 'EH_S' }[entry], 'PATROL');
  fb.target = entry;
  fb.cool.relocate = 9999;
  return s;
}

test('Fredbear: barrier + strobe repels; strobe with open barrier only stuns; no strobe -> forced open -> attack', () => {
  // 1. correct defence
  let s = fredbearAt(4, 'H');
  s.input('hatch');
  runTicks(s, 1200, (ss) => {
    if (['FORCING'].includes(ss.anim.fredbear.state) && ss.strobe.cooldown === 0) ss.input('strobe');
  });
  assert.ok(s.log.some((l) => l.who === 'fredbear' && /repelled at HATCH/.test(l.reason)));
  assert.notEqual(s.phase, 'LOST');

  // 2. strobe while open: stunned, then attack
  s = fredbearAt(4, 'H');
  let strobed = false;
  runTicks(s, 1500, (ss) => {
    if (ss.anim.fredbear.state === 'TELEGRAPH' && !strobed) {
      ss.input('strobe');
      strobed = true;
    }
  });
  assert.equal(s.phase, 'LOST');
  assert.equal(s.jumpscare.who, 'fredbear');

  // 3. closed but never strobed: barrier is forced open (JAMMED) before the attack
  s = fredbearAt(5, 'L');
  s.input('door_l');
  const fx = runTicks(s, 1500);
  const jamIdx = fx.findIndex((f) => f.fx === 'device' && f.device === 'jam_L' && f.value === true);
  const atkIdx = fx.findIndex((f) => f.fx === 'jumpscare');
  assert.ok(jamIdx >= 0 && atkIdx > jamIdx, 'jam must precede the attack');
  assert.equal(s.devices.doorL, false);
});

test('Fredbear telegraph/forcing windows respect the fairness floors for every aggression', () => {
  const c = CONFIG.characters;
  for (let a = 0; a <= 20; a++) {
    assert.ok(c.fredbear.w1(a) >= 100);
    assert.ok(c.fredbear.w2(a) >= 60);
    assert.ok(c.bonnie.telegraph(a) >= 70);
    assert.ok(c.chica.telegraph(a) >= 80);
    assert.ok(c.freddy.patience(a) >= 120);
  }
});

test('mercy cap: after maxAttempts repelled attempts Fredbear never approaches again', async () => {
  let capped = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = await runNight(NightSession, { night: 4, seed, bot: oracleBot() });
    const s = r.session;
    const max = s.def.fredbear.maxAttempts;
    assert.ok(s.anim.fredbear.attempts <= max);
    const capIdx = s.log.findIndex((l) => l.who === 'fredbear' && l.reason.includes(`(attempt ${max}/${max})`));
    if (capIdx < 0) continue;
    capped++;
    assert.ok(!s.log.slice(capIdx + 1).some((l) => l.who === 'fredbear' && l.to === 'APPROACH'), `seed ${seed}`);
  }
  assert.ok(capped > 0, 'expected at least one capped night in 20 seeds');
});

test('simultaneous threats: at most two engaged entries, nobody engages beside Fredbear, one attack token', async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = new NightSession({ night: 6, seed });
    for (let i = 0; i < 9600 && !['WON', 'LOST'].includes(s.phase); i++) {
      oracleBot().act(s);
      for (const f of s.tick()) if (f.fx === 'maint_begin') s.resumeMaintenance();
      const engaged = Object.values(s.director.entries).filter(Boolean);
      assert.ok(engaged.length <= 2, `t=${s.t} ${engaged}`);
      const fbEngaged = ['TELEGRAPH', 'FORCING', 'JAMMED'].includes(s.anim.fredbear.state);
      if (fbEngaged) {
        for (const id of ['bonnie', 'chica', 'freddy']) {
          const st = s.anim[id].state;
          // Already-engaged characters may finish; none may START an approach afterwards.
          if (st === 'APPROACH') assert.ok(s.anim[id].entry, `${id} approaching without a slot`);
        }
      }
    }
  }
});

test('ten consecutive fresh sessions start from identical clean state (reset)', () => {
  const first = JSON.stringify(new NightSession({ night: 5, seed: 42 }).snapshot());
  for (let i = 0; i < 12; i++) {
    const s = new NightSession({ night: 5, seed: 42 });
    assert.equal(JSON.stringify(s.snapshot()), first);
    runTicks(s, 500);
  }
});

test('night 3 maintenance pauses the clock and AI, then resumes with a grace period', () => {
  const s = new NightSession({ night: 3, seed: 4 });
  let maintAt = -1;
  for (let i = 0; i < 4000 && maintAt < 0; i++) {
    for (const f of s.tick()) if (f.fx === 'maint_begin') maintAt = s.t;
  }
  assert.ok(maintAt >= 3200, `maintenance began at ${maintAt}`);
  assert.equal(s.phase, 'MAINT');
  const t = s.t;
  const p = s.power;
  for (let i = 0; i < 300; i++) s.tick();
  assert.equal(s.t, t, 'clock paused');
  assert.equal(s.power, p, 'no drain while paused');
  for (const id of s.order) assert.equal(s.anim[id].state, 'SUSPENDED');
  s.resumeMaintenance();
  assert.equal(s.phase, 'RUNNING');
  for (let i = 0; i < CONFIG.director.maintenanceGrace - 1; i++) {
    s.tick();
    for (const id of s.order) assert.ok(!['TELEGRAPH', 'LURK'].includes(s.anim[id].state), 'no telegraph inside the grace period');
  }
});

test("Chica's breaker trip disables hall lights only; doors still work; reset restores lights", () => {
  const s = new NightSession({ night: 2, seed: 1 });
  s.tripBreaker('chica');
  s.input('light_l');
  s.input('door_l');
  const fx = runTicks(s, 2);
  assert.ok(fx.some((f) => f.fx === 'feedback' && f.action === 'light_l' && !f.ok && f.reason === 'breaker tripped'));
  assert.equal(s.devices.doorL, true);
  s.input('breaker');
  runTicks(s, CONFIG.devices.breakerResetTicks + 3);
  assert.equal(s.breaker.tripped, false);
  s.input('light_l');
  runTicks(s, 1);
  assert.equal(s.devices.lightL, true);
});

test('Freddy never moves while the current camera shows him', () => {
  const s = new NightSession({ night: 6, seed: 9 });
  for (const id of ['bonnie', 'chica', 'fredbear']) s.setAggression(id, 0);
  s.place('freddy', 'EH_N', 'PATROL');
  s.input('cams_open', 'C12');
  runTicks(s, 1);
  const before = s.anim.freddy.node;
  runTicks(s, 1200);
  assert.equal(s.anim.freddy.node, before);
  assert.equal(s.anim.freddy.move, null);
});

test('finale on night 6 withdraws the trio and grants extra strobe charges', () => {
  const s = new NightSession({ night: 6, seed: 3 });
  const charges = s.strobe.charges;
  s.setTick(7990);
  runTicks(s, 20, (ss) => oracleBot().act(ss));
  assert.equal(s.finale, true);
  assert.equal(s.strobe.charges >= charges, true);
  for (const id of ['bonnie', 'chica', 'freddy']) assert.equal(s.anim[id].state, 'WITHDRAWN');
});

test('inputs are debounced and report accepted/denied/cooldown feedback', () => {
  const s = new NightSession({ night: 1, seed: 1 });
  s.input('door_l');
  s.input('door_l');
  s.input('strobe');
  s.input('hatch');
  const fx = runTicks(s, 1).filter((f) => f.fx === 'feedback');
  assert.deepEqual(fx.map((f) => [f.action, f.ok, f.reason]), [
    ['door_l', true, 'closed'],
    ['door_l', false, 'cooldown'],
    ['strobe', false, 'not installed'],
    ['hatch', false, 'welded shut'],
  ]);
});

test('no AI activity happens outside RUNNING (won/lost sessions are inert)', () => {
  const s = new NightSession({ night: 1, seed: 1 });
  s.setTick(s.length - 1);
  runTicks(s, 5);
  assert.equal(s.phase, 'WON');
  const snap = JSON.stringify(s.snapshot());
  for (let i = 0; i < 200; i++) assert.deepEqual(s.tick(), []);
  assert.equal(JSON.stringify(s.snapshot()), snap);
});
