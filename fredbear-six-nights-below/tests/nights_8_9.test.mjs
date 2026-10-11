// Logic tests for nights 8 and 9 (pure simulation, no Minecraft): Morgrave ("invite him in", 1.4),
// Valek (the staring contest, 1.4), the ceiling vent, vent seals, double trouble, teamwork and the
// "stuck at the door" fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG, LAST_NIGHT, nightVariant } from '../packs/FredbearBP/scripts/core/config.js';
import { NODE_BY_ID, STORE_NODE } from '../packs/FredbearBP/scripts/data/nodes.js';
import { idleBot, oracleBot, humanBot, wastefulBot, runNight } from '../tools/lib/bots.mjs';

const VARIANTS = [
  ['8 seal', 8, nightVariant(8, 'seal')],
  ['8 burn', 8, nightVariant(8, 'burn')],
  ['9', 9, {}],
];

/** Queue a player action, run one tick and return the session's feedback for it. */
function act(s, action, arg) {
  s.input(action, arg);
  for (const f of s.tick()) if (f.fx === 'feedback' && f.action === action) return f;
  return undefined;
}

function step(s, n, each) {
  for (let i = 0; i < n && !['WON', 'LOST'].includes(s.phase); i++) {
    each?.(s);
    for (const f of s.tick()) if (f.fx === 'maint_begin') s.resumeMaintenance();
  }
}

/** A night-8 session (seal for Morgrave, burn for Valek) past the start grace, the old trio switched off. */
function visitSession(who, seed = 3) {
  const s = new NightSession({ night: 8, seed, overrides: nightVariant(8, who === 'morgrave' ? 'seal' : 'burn') });
  s.setTick(CONFIG.clock.ticksPerHour);
  for (const id of ['freddy', 'bonnie', 'chica']) s.setAggression(id, 0);
  return s;
}

/** Step until `pred` holds (or fail after `max` ticks); collects captions. */
function until(s, pred, max, captions = [], each) {
  for (let i = 0; i < max; i++) {
    if (pred(s)) return captions;
    each?.(s);
    for (const f of s.tick()) {
      if (f.fx === 'caption') captions.push(f.text);
      if (f.fx === 'maint_begin') s.resumeMaintenance();
    }
  }
  assert.ok(pred(s), `condition not reached in ${max} ticks`);
  return captions;
}

test('the campaign has nine nights; night 8 has a seal and a burn version', () => {
  assert.equal(LAST_NIGHT, 9);
  for (let n = 1; n <= 9; n++) assert.ok(CONFIG.nights[n], `night ${n}`);
  assert.equal(nightVariant(8, 'seal').ai.morgrave > 0, true);
  assert.equal(nightVariant(8, 'burn').ai.valek > 0, true);
  assert.deepEqual(nightVariant(7, 'seal'), {});
});

test('nights 8 (both versions) and 9 are beatable with a valid defence (oracle, 10 seeds each)', async () => {
  for (const [label, night, overrides] of VARIANTS) {
    for (let seed = 1; seed <= 10; seed++) {
      const r = await runNight(NightSession, { night, seed, overrides, bot: oracleBot() });
      assert.equal(r.result, 'WON', `night ${label} seed ${seed} lost to ${r.attacker}`);
      assert.equal(r.t, CONFIG.clock.ticksPerHour * 6);
    }
  }
});

test('who hunts: seal -> Morgrave, burn -> Valek, night 9 -> Fredbear + Morgrave + Valek with the trio stored', async () => {
  const active = (s, id) => s.log.some((l) => l.who === id && l.from === 'DORMANT');
  for (let seed = 1; seed <= 4; seed++) {
    const seal = (await runNight(NightSession, { night: 8, seed, overrides: nightVariant(8, 'seal'), bot: oracleBot() })).session;
    assert.ok(active(seal, 'morgrave'), 'Morgrave wakes on the seal night');
    assert.ok(!active(seal, 'valek') && !active(seal, 'fredbear'), 'nobody else new on the seal night');
    const burn = (await runNight(NightSession, { night: 8, seed, overrides: nightVariant(8, 'burn'), bot: oracleBot() })).session;
    assert.ok(active(burn, 'valek'), 'Valek wakes on the burn night');
    assert.ok(!active(burn, 'morgrave') && !active(burn, 'fredbear'), 'nobody else new on the burn night');
    const nine = (await runNight(NightSession, { night: 9, seed, bot: oracleBot() })).session;
    for (const id of ['fredbear', 'morgrave', 'valek']) assert.ok(active(nine, id), `${id} hunts on night 9`);
    for (const id of ['freddy', 'bonnie', 'chica']) {
      assert.equal(nine.anim[id].state, 'DORMANT', `${id} stays switched off on night 9`);
      assert.equal(nine.anim[id].node, STORE_NODE[id], `${id} sits in Parts & Service`);
    }
  }
});

test('Morgrave only attacks from ANGRY (he broke a shut entry); Valek only from STARE', async () => {
  let attacks = 0;
  for (const [, night, overrides] of VARIANTS) {
    for (let seed = 1; seed <= 12; seed++) {
      for (const bot of [idleBot(), wastefulBot()]) {
        const r = await runNight(NightSession, { night, seed, overrides, bot });
        const atk = r.session.log.find((l) => l.to === 'ATTACK');
        if (!atk || !['morgrave', 'valek'].includes(atk.who)) continue;
        attacks++;
        assert.equal(atk.from, atk.who === 'valek' ? 'STARE' : 'ANGRY', `${atk.who} attacked from ${atk.from}`);
        if (atk.who === 'morgrave') assert.match(atk.reason, /stayed shut/);
        else assert.match(atk.reason, /from up close/);
      }
    }
  }
  assert.ok(attacks > 10, `expected attacks from idle/wasteful bots, got ${attacks}`);
});

test('Morgrave: three soft knocks at an open door -> he walks past and nothing happens', () => {
  const s = visitSession('morgrave');
  const m = s.anim.morgrave;
  assert.equal(s.forceVisit('morgrave', 'L'), true);
  const caps = until(s, () => m.state === 'KNOCK', 100);
  assert.ok(caps.includes('Three soft knocks — LEFT DOOR'));
  assert.equal(s.barrierClosed('L'), false, 'the left door starts open');
  until(s, () => m.state === 'PASS', CONFIG.characters.morgrave.softKnockTicks + 2);
  until(s, () => m.state === 'WALLS', CONFIG.characters.morgrave.passTicks + 2);
  assert.equal(s.phase, 'RUNNING');
  assert.ok(s.log.some((l) => l.who === 'morgrave' && l.reason === 'let in: he went past'));
});

test('Morgrave: keep the door shut and he gets angrier, then breaks through; open it late and he passes', () => {
  const C = CONFIG.characters.morgrave;
  const s = visitSession('morgrave');
  const m = s.anim.morgrave;
  act(s, 'door_r');
  s.forceVisit('morgrave', 'R');
  until(s, () => m.state === 'KNOCK', 100);
  const caps = until(s, () => m.state === 'ANGRY' && m.visit.stage === 2, C.softKnockTicks + C.angry(m.aggression) + 4);
  assert.ok(caps.includes('Knocking — RIGHT DOOR, louder') && caps.includes('Pounding — RIGHT DOOR!'), caps.join(' | '));
  until(s, () => s.phase === 'JUMPSCARE', C.angry(m.aggression) + 4);
  assert.equal(s.jammed.R, true, 'he forced the right door open');
  assert.equal(s.devices.doorR, false);
  assert.equal(s.jumpscareStyle('morgrave'), 'front');

  // Open up while he pounds: he only wanted to be let in.
  const s2 = visitSession('morgrave', 4);
  const m2 = s2.anim.morgrave;
  act(s2, 'door_l');
  s2.forceVisit('morgrave', 'L');
  until(s2, () => m2.state === 'ANGRY' && m2.visit.stage === 2, 400);
  act(s2, 'door_l');
  until(s2, () => m2.state === 'WALLS', C.passTicks + 4);
  assert.equal(s2.phase, 'RUNNING');
  assert.ok(s2.log.some((l) => l.who === 'morgrave' && l.reason === 'let in late'));
});

test('Morgrave at the ceiling vent: open the grate to let him crawl past; he shuts it behind him; kept shut -> from above', () => {
  const C = CONFIG.characters.morgrave;
  const s = visitSession('morgrave');
  const m = s.anim.morgrave;
  assert.equal(s.devices.grate, true, 'the grate starts closed');
  s.forceVisit('morgrave', 'V');
  until(s, () => m.state === 'KNOCK', 100);
  const f = act(s, 'vent_grate');
  assert.equal(f.ok, true);
  assert.equal(f.reason, 'opened');
  assert.equal(s.devices.grate, false);
  until(s, () => m.state === 'PASS', C.softKnockTicks + 2);
  const caps = until(s, () => m.state === 'WALLS', C.passTicks + 2);
  assert.ok(caps.includes('The vent grate clangs shut'), caps.join(' | '));
  assert.equal(s.devices.grate, true, 'he closed the grate behind him');
  assert.equal(s.phase, 'RUNNING');

  const s2 = visitSession('morgrave', 5);
  s2.forceVisit('morgrave', 'V');
  until(s2, () => s2.phase === 'JUMPSCARE', 100 + C.softKnockTicks + 2 * C.angry(s2.anim.morgrave.aggression) + 10);
  assert.equal(s2.devices.grate, false, 'the grate burst open');
  assert.equal(s2.jumpscareStyle('morgrave'), 'above');
});

test('Morgrave never breaks a door while someone else is held at it, and leaves 3 s once they go', () => {
  const C = CONFIG.characters.morgrave;
  const s = visitSession('morgrave', 6);
  const m = s.anim.morgrave;
  act(s, 'door_l');
  s.forceVisit('morgrave', 'L');
  until(s, () => m.state === 'ANGRY' && m.visit.stage === 2, 400);
  s.director.entries.L = 'bonnie'; // Bonnie held at the same door
  step(s, 600);
  assert.equal(m.state, 'ANGRY', 'he waits while Bonnie is at the door');
  s.director.entries.L = null;
  step(s, C.holdFloor - 2);
  assert.equal(m.state, 'ANGRY', 'at least holdFloor ticks after she left');
  until(s, () => s.phase === 'JUMPSCARE', 10);
});

test('the vent grate: a button with a debounce; nobody comes knocking while Fredbear is engaged', () => {
  const s = visitSession('morgrave');
  const fx = [];
  s.input('vent_grate');
  fx.push(...s.tick());
  assert.equal(s.devices.grate, false);
  assert.ok(fx.some((f) => f.fx === 'actuate' && f.id === 'grate_open'));
  assert.equal(act(s, 'vent_grate').reason, 'cooldown');
  step(s, CONFIG.devices.doorDebounce + 1);
  assert.equal(act(s, 'vent_grate').reason, 'closed');
  assert.equal(s.snapshot().devices.grate, true);
  // While Fredbear is engaged nobody new comes knocking.
  s.anim.fredbear.state = 'TELEGRAPH';
  s.forceVisit('morgrave', 'L');
  step(s, 200, () => (s.anim.fredbear.state = 'TELEGRAPH'));
  assert.equal(s.anim.morgrave.state, 'WALLS');
});

test('Valek: stare him down and he looks away first; never look, or look away, and he steps closer, then attacks', () => {
  const C = CONFIG.characters.valek;
  const s = visitSession('valek');
  const v = s.anim.valek;
  act(s, 'door_l'); // doors do not stop him
  s.forceVisit('valek', 'L');
  const caps = until(s, () => v.state === 'STARE', 100);
  assert.ok(caps.includes('Two small eyes in the dark — LEFT DOOR'));
  assert.equal(v.visit.stage, 'far');
  const caps2 = until(s, () => v.state !== 'STARE', C.hold(v.aggression)[1] + 4, [], () => s.setGaze('valek'));
  assert.equal(v.state, 'LEAVE');
  assert.ok(caps2.includes('He looks away first…'));
  s.setGaze(null);
  until(s, () => v.state === 'VANISH', C.turnAway + 2);
  assert.equal(s.phase, 'RUNNING');

  // Never looks: far -> near -> attack, through a shut door.
  const s2 = visitSession('valek', 4);
  const v2 = s2.anim.valek;
  act(s2, 'door_r');
  s2.forceVisit('valek', 'R');
  until(s2, () => v2.state === 'STARE', 100);
  const caps3 = until(s2, () => v2.visit.stage === 'near', C.find(v2.aggression) + 2);
  assert.ok(caps3.includes('The eyes are closer — RIGHT DOOR'));
  until(s2, () => s2.phase === 'JUMPSCARE', C.findNear(v2.aggression) + 2);
  assert.equal(s2.devices.doorR, true, 'the door was shut the whole time');

  // A glance away shorter than the slack does not count; a longer one does.
  const s3 = visitSession('valek', 5);
  const v3 = s3.anim.valek;
  s3.forceVisit('valek', 'V');
  until(s3, () => v3.state === 'STARE', 100);
  v3.visit.need = 10000; // keep the contest going
  step(s3, 20, () => s3.setGaze('valek'));
  step(s3, C.slack - 2, () => s3.setGaze(null));
  step(s3, 5, () => s3.setGaze('valek'));
  assert.equal(v3.visit.stage, 'far', 'a short glance away is forgiven');
  step(s3, C.slack + 2, () => s3.setGaze(null));
  assert.equal(v3.visit.stage, 'near', 'looking away for longer: he stepped closer');
  assert.equal(s3.jumpscareStyle('valek'), 'above');
});

test('Valek: opening the cameras counts as looking away', () => {
  const s = visitSession('valek', 7);
  const v = s.anim.valek;
  s.forceVisit('valek', 'L');
  until(s, () => v.state === 'STARE', 100);
  v.visit.need = 10000;
  step(s, 10, () => s.setGaze('valek'));
  assert.equal(v.visit.stage, 'far');
  act(s, 'cams_open', 'C14');
  step(s, 2, () => s.setGaze('valek'));
  assert.equal(v.visit.stage, 'near', 'the cameras broke the stare');
});

test('vent seals: cost power, block the duct, expire, recharge', () => {
  const s = new NightSession({ night: 8, seed: 3, overrides: nightVariant(8, 'seal') });
  const before = s.power;
  assert.equal(act(s, 'seal_vent').ok, true);
  assert.ok(s.power <= before - CONFIG.seals.cost && s.power > before - CONFIG.seals.cost - 50, 'the seal cost 3 % power');
  assert.equal(s.gateOpen('vent_seal'), false);
  assert.equal(act(s, 'seal_vent').reason, 'already sealed');
  step(s, CONFIG.seals.duration);
  assert.equal(s.gateOpen('vent_seal'), true, 'the seal opens by itself');
  assert.equal(act(s, 'seal_vent').reason, 'cooldown');
  step(s, CONFIG.seals.cooldown + 2);
  assert.equal(act(s, 'seal_vent').ok, true, 'recharged');
  // The shaft seal needs the hatch (installed on nights 8 and 9).
  assert.equal(act(new NightSession({ night: 2, seed: 1 }), 'seal_shaft').reason, 'not installed');
  assert.equal(act(s, 'seal_shaft').ok, true);
});

test('no animatronic stands idle at a door (the 1.2 "stuck at the door" bug)', async () => {
  const ENGAGED = ['APPROACH', 'TELEGRAPH', 'LURK', 'ATTACK', 'RETREAT', 'POWEROUT', 'WITHDRAWN', 'SUSPENDED'];
  for (let night = 2; night <= 8; night++) {
    for (let seed = 1; seed <= 6; seed++) {
      for (const bot of [oracleBot(), humanBot(seed)]) {
        const s = new NightSession({ night, seed, overrides: night === 8 ? nightVariant(8, 'seal') : undefined });
        const idle = { freddy: 0, bonnie: 0, chica: 0 };
        for (let i = 0; i < 9600 && !['WON', 'LOST'].includes(s.phase); i++) {
          bot.act(s);
          for (const f of s.tick()) if (f.fx === 'maint_begin') s.resumeMaintenance();
          for (const id of Object.keys(idle)) {
            const a = s.anim[id];
            const stuck = !a.move && NODE_BY_ID[a.node]?.zone === 'entry' && !ENGAGED.includes(a.state);
            idle[id] = stuck ? idle[id] + 1 : 0;
            assert.ok(idle[id] < 5, `night ${night} seed ${seed} ${bot.name}: ${id} idle at ${a.node} in ${a.state}`);
          }
        }
      }
    }
  }
});

test('double trouble and teamwork happen on hard nights; two at one door take twice as long to leave', async () => {
  let partners = 0;
  let teamwork = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = await runNight(NightSession, { night: 6, seed, bot: humanBot(seed) });
    partners += r.session.log.filter((l) => /joining/i.test(l.reason)).length;
    teamwork += r.session.log.filter((l) => /teamwork|bangs/i.test(l.reason)).length;
  }
  assert.ok(partners > 0, 'someone joined another animatronic at the right door');
  assert.ok(teamwork > 0, 'Bonnie banged on the left door for Chica');

  // Chica at the right door with Bonnie beside her: the door must stay shut twice as long.
  const s = new NightSession({ night: 6, seed: 9 });
  s.setTick(CONFIG.clock.ticksPerHour); // past the start-of-night grace
  for (const [who, node] of [['chica', 'E_DOOR'], ['bonnie', 'E_DOOR_B']]) {
    s.place(who, node, 'TELEGRAPH');
    const a = s.anim[who];
    a.entry = 'R';
    a.timer = 2000;
    a.closedTicks = 0;
  }
  assert.ok(s.director.reserveEntry('chica', 'R'));
  assert.ok(s.director.reservePartner('bonnie', 'R'));
  assert.ok(s.director.pairAt('R'), 'a pair at the right door');
  s.input('door_r');
  const repel = CONFIG.characters.chica.repelTicks;
  step(s, repel + 5);
  assert.equal(s.anim.chica.state, 'TELEGRAPH', 'one repel time is not enough against two');
  assert.equal(s.anim.bonnie.state, 'TELEGRAPH');
  step(s, repel + 5);
  assert.notEqual(s.anim.chica.state, 'TELEGRAPH', 'twice the repel time sends her away');
  assert.notEqual(s.anim.bonnie.state, 'TELEGRAPH', 'and him');
});
