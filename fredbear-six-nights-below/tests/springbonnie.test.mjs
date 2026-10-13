// Springbonnie (1.5): Fredbear's partner. Dormant beside Fredbear in the chamber, he hunts only in
// night 6's Golden Hour, at the LEFT door only (pure simulation, no Minecraft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG } from '../packs/FredbearBP/scripts/core/config.js';
import { oracleBot, idleBot, runNight } from '../tools/lib/bots.mjs';

test('Springbonnie stays slumped beside Fredbear on every night but night 6', async () => {
  for (const night of [1, 2, 3, 4, 5, 7, 8, 9]) {
    const r = await runNight(NightSession, { night, seed: 3, bot: oracleBot() });
    const sb = r.session.anim.springbonnie;
    assert.equal(sb.state, 'DORMANT', `night ${night}`);
    assert.equal(sb.node, 'SB_HOME');
    assert.equal(sb.pose().anim, 'dormant');
  }
});

test('night 6: he wakes with the Golden Hour and hunts the left door; a valid defence still wins', async () => {
  let telegraphs = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = await runNight(NightSession, { night: 6, seed, bot: oracleBot() });
    assert.equal(r.result, 'WON', `seed ${seed} lost to ${r.attacker}`);
    const log = r.session.log.filter((l) => l.who === 'springbonnie');
    const wake = log.find((l) => l.from === 'DORMANT');
    assert.ok(wake, 'he woke up');
    assert.ok(wake.t >= 8000, `not before the Golden Hour (t ${wake.t})`);
    for (const l of log.filter((x) => x.to === 'TELEGRAPH')) {
      telegraphs++;
      assert.ok(l.t >= 8000);
    }
    assert.ok(!log.some((l) => l.to === 'ATTACK'), 'never gets in against a valid defence');
  }
  assert.ok(telegraphs > 0, 'he reached the left door at least once');
});

test('Springbonnie only attacks from TELEGRAPH through the open LEFT door; a shut door sends him back', async () => {
  for (let seed = 1; seed <= 10; seed++) {
    const r = await runNight(NightSession, { night: 6, seed, bot: idleBot() });
    const atk = r.session.log.find((l) => l.to === 'ATTACK' && l.who === 'springbonnie');
    if (!atk) continue;
    assert.equal(atk.from, 'TELEGRAPH');
    assert.equal(r.session.anim.springbonnie.entry, 'L');
  }
  const s = new NightSession({ night: 6, seed: 9 });
  s.setTick(8050);
  s.finale = true;
  s.director.finale = true;
  const sb = s.anim.springbonnie;
  s.place('springbonnie', 'W_DOOR', 'TELEGRAPH');
  assert.ok(s.director.reserveEntry('springbonnie', 'L'), 'he may engage in the Golden Hour');
  assert.equal(s.director.canApproach('bonnie', 'R'), false, 'the others may not');
  sb.entry = 'L';
  sb.timer = 400;
  sb.closedTicks = 0;
  s.input('door_l');
  for (let i = 0; i < CONFIG.characters.springbonnie.repelTicks + 5; i++) s.tick();
  assert.notEqual(sb.state, 'TELEGRAPH', 'repelled by the shut door');
  assert.equal(s.phase, 'RUNNING');
});
