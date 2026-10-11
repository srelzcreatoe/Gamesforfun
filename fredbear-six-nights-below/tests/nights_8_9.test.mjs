// 1.3 logic tests: nights 8 and 9, Morgrave, Valek, vent seals, double trouble,
// teamwork and the "stuck at the door" fix (pure simulation, no Minecraft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG, LAST_NIGHT, nightVariant } from '../packs/FredbearBP/scripts/core/config.js';
import { NODE_BY_ID, VALEK_LADDER, MORGRAVE_ROUTE, STORE_NODE } from '../packs/FredbearBP/scripts/data/nodes.js';
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

test('Morgrave and Valek only attack from their warning state, through an open entry', async () => {
  let attacks = 0;
  for (const [, night, overrides] of VARIANTS) {
    for (let seed = 1; seed <= 12; seed++) {
      for (const bot of [idleBot(), wastefulBot()]) {
        const r = await runNight(NightSession, { night, seed, overrides, bot });
        const atk = r.session.log.find((l) => l.to === 'ATTACK');
        if (!atk || !['morgrave', 'valek'].includes(atk.who)) continue;
        attacks++;
        assert.equal(atk.from, atk.who === 'valek' ? 'CORNER' : 'TELEGRAPH', `${atk.who} attacked from ${atk.from}`);
        const entry = r.session.anim[atk.who].entry;
        assert.ok(entry, 'attack without an entry');
        assert.equal(r.session.barrierClosed(entry), false, `${atk.who} attacked through a closed ${entry}`);
      }
    }
  }
  assert.ok(attacks > 10, `expected attacks from idle/wasteful bots, got ${attacks}`);
});

test('vent seals: cost power, block the duct, expire, recharge; Morgrave gives up against a sealed duct', () => {
  const s = new NightSession({ night: 8, seed: 3, overrides: nightVariant(8, 'seal') });
  const before = s.power;
  assert.equal(act(s, 'seal_vent').ok, true);
  assert.ok(s.power <= before - CONFIG.seals.cost && s.power > before - CONFIG.seals.cost - 50, 'the seal cost 3 % power');
  assert.equal(s.gateOpen('vent_seal'), false);
  assert.equal(act(s, 'seal_vent').reason, 'already sealed');
  // Morgrave in the duct, facing the sealed exit.
  const m = s.anim.morgrave;
  s.place('morgrave', MORGRAVE_ROUTE.L[1], 'CRAWL');
  m.route = 'L';
  m.target = 'L';
  m.hidden = false;
  step(s, CONFIG.characters.morgrave.sealGiveUp + 5);
  assert.equal(m.state, 'WALLS', 'he gave up and went back into the walls');
  assert.ok(s.log.some((l) => l.who === 'morgrave' && l.reason.includes('sealed out')));
  step(s, CONFIG.seals.duration);
  assert.equal(s.gateOpen('vent_seal'), true, 'the seal opens by itself');
  assert.equal(act(s, 'seal_vent').reason, 'cooldown');
  step(s, CONFIG.seals.cooldown + 2);
  assert.equal(act(s, 'seal_vent').ok, true, 'recharged');
  // The shaft seal needs the hatch (installed on nights 8 and 9).
  assert.equal(act(new NightSession({ night: 2, seed: 1 }), 'seal_shaft').reason, 'not installed');
  assert.equal(act(s, 'seal_shaft').ok, true);
});

test('Valek: never steps while watched; lit corner -> vanishes angrier; dark open corner -> attack', () => {
  const s = new NightSession({ night: 8, seed: 5, overrides: nightVariant(8, 'burn') });
  const v = s.anim.valek;
  s.setAggression('valek', 20);
  s.place('valek', VALEK_LADDER.L[1], 'STEP');
  v.side = 'L';
  v.hidden = false;
  act(s, 'cams_open', 'C07'); // the West Hall camera shows every middle rung
  assert.ok(v.isObserved(), 'C07 shows his rung');
  step(s, 1200, () => {
    if (!s.devices.cams.open) s.input('cams_open', 'C07');
  });
  assert.equal(v.node, VALEK_LADDER.L[1], 'he did not step while watched');
  s.input('cams_close');
  step(s, 2000, () => {
    if (s.devices.cams.open) s.input('cams_close');
  });
  assert.notEqual(v.node, VALEK_LADDER.L[1], 'he stepped once unwatched');

  // Lit corner: gone at once, anger +1.
  const s2 = new NightSession({ night: 8, seed: 6, overrides: nightVariant(8, 'burn') });
  const v2 = s2.anim.valek;
  s2.place('valek', VALEK_LADDER.L.at(-1), 'CORNER');
  s2.director.reserveEntry('valek', 'L');
  v2.entry = 'L';
  v2.timer = 100;
  act(s2, 'light_l');
  step(s2, 2);
  assert.equal(v2.state, 'VANISH');
  assert.equal(v2.anger, 1);

  // Dark and open: he attacks when the window ends.
  const s3 = new NightSession({ night: 8, seed: 7, overrides: nightVariant(8, 'burn') });
  const v3 = s3.anim.valek;
  s3.place('valek', VALEK_LADDER.R.at(-1), 'CORNER');
  s3.director.reserveEntry('valek', 'R');
  v3.entry = 'R';
  v3.timer = 30;
  step(s3, 60);
  assert.equal(s3.phase === 'LOST' || v3.state === 'ATTACK', true, 'attacked from the dark corner');
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
