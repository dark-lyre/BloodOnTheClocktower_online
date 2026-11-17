import assert from 'node:assert/strict';
import test from 'node:test';
import { startNight } from '../lib/engine.js';
import { startDay } from '../lib/day.js';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { impaired, isPoisoned, poisonerPoisons, monkProtects, hasEff, addEff, dropEff, seatTags, tagWhy, keptAbility } from '../lib/util.js';
import { changeRole, killSeat, revive } from '../lib/rules.js';
import { viewFor } from '../lib/view.js';
import { setup, S, ok, act } from './helpers.js';

// Official: abilities and their persistent effects end immediately on death,
// drunkenness or poisoning: https://wiki.bloodontheclocktower.com/Abilities
test('Monk protection ends immediately if the Monk dies before a later Po attack', () => {
  const room = setup(['monk', 'po', 'chef', 'saint', 'baron', 'washerwoman', 'soldier']);
  const monk = S(room, 'monk'), po = S(room, 'po'), target = S(room, 'chef'), third = S(room, 'saint');
  room.g.poCharge = { [po.id]: true };
  startNight(room);
  assert.equal(room.g.step.roleId, 'monk');
  act(room, 'monk', [target.id]);
  assert.equal(room.g.protected, target.id);
  assert.equal(room.g.step.roleId, 'po');
  ok(applyPlayerAction(room, po.pid, { act: 'pick', ids: [monk.id, target.id, third.id] }));

  assert.equal(monk.dead, true);
  assert.equal(third.dead, true);
  assert.equal(room.phase, 'night');
  assert.equal(room.winner, null);
  assert.equal(target.dead, true, 'the dead Monk no longer protects the second target');
  assert.deepEqual(room.g.step.result.e.each.map(x => x.res), ['kill', 'kill', 'kill']);
});

test('Poisoner poison pauses when a Courtier makes the Poisoner drunk later that night', () => {
  const room = setup(['poisoner', 'courtier', 'imp', 'soldier', 'saint', 'washerwoman', 'baron']);
  const poisoner = S(room, 'poisoner'), courtier = S(room, 'courtier'), target = S(room, 'soldier');
  startNight(room);
  assert.equal(room.g.step.roleId, 'poisoner');
  act(room, 'poisoner', [target.id]);
  assert.equal(isPoisoned(room, target), true);
  assert.equal(room.g.step.roleId, 'courtier');
  ok(applyPlayerAction(room, courtier.pid, { act: 'pick', ids: [], role: 'poisoner' }));

  assert.equal(impaired(room, poisoner), true);
  assert.equal(target.dead, false);
  assert.equal(isPoisoned(room, target), false, 'the drunk Poisoner cannot maintain the existing poison');
});

// The nominator is executed immediately, before using any further abilities:
// https://wiki.bloodontheclocktower.com/Virgin
test('a Slayer who has triggered the Virgin cannot shoot before the pending execution resolves', () => {
  const room = setup(['slayer', 'virgin', 'imp', 'poisoner', 'chef', 'saint', 'soldier']);
  const slayer = S(room, 'slayer'), virgin = S(room, 'virgin'), imp = S(room, 'imp');
  startDay(room);
  ok(applyPlayerAction(room, slayer.pid, { act: 'nominate', targetId: virgin.id }));

  // The UI may defer its animation, but cannot let the executed Slayer kill.
  applyPlayerAction(room, slayer.pid, { act: 'slay', targetId: imp.id });
  if (room.g.ruling?.kind === 'slayer') ok(applyStOp(room, { op: 'rule', work: true }));
  assert.equal(imp.dead, false, 'the Slayer was already executed by the Virgin');
  assert.equal(room.winner, null);
  assert.equal(room.g.slayerUsed, false);
  ok(applyStOp(room, { op: 'virgin', work: true }));
  assert.equal(slayer.dead, true, 'the Storyteller can still resolve the execution');
});

for (const devices of ['one', 'many']) {
  test(`offline ${devices}: the Storyteller cannot shoot for the Virgin nominator`, () => {
    const room = setup(['slayer', 'virgin', 'imp', 'poisoner', 'chef', 'saint', 'soldier']);
    const slayer = S(room, 'slayer'), virgin = S(room, 'virgin'), imp = S(room, 'imp');
    Object.assign(room.settings, { venue: 'offline', devices });
    startDay(room);
    if (devices === 'many') ok(applyPlayerAction(room, slayer.pid, { act: 'slay', targetId: imp.id }));
    const asked = room.g.asks?.find(a => a.kind === 'slay')?.id;
    ok(applyStOp(room, { op: 'nominate', fromId: slayer.id, toId: virgin.id }));
    const result = applyStOp(room, { op: 'slayFor', fromId: slayer.id, toId: imp.id });
    assert.equal(typeof result, 'string');
    if (asked) assert.equal(typeof applyStOp(room, { op: 'slayFor', ask: asked, toId: imp.id }), 'string');
    assert.equal(room.g.ruling, null);
    assert.equal(imp.dead, false);
    ok(applyStOp(room, { op: 'virgin', work: true }));
    assert.equal(slayer.dead, true);
  });
}

const effects = [
  { role: 'poisoner', field: 'poisoned', kind: 'poison', tag: '中毒', active: poisonerPoisons, list: 'poisonList' },
  { role: 'monk', field: 'protected', kind: 'protect', tag: '被保護', active: monkProtects, list: 'protectList' },
];
function automatic(effect) {
  const room = setup([effect.role, 'imp', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
  const source = S(room, effect.role), target = S(room, 'chef');
  startNight(room);
  act(room, effect.role, [target.id]);
  assert.equal(room.g[effect.field + 'By'], source.id);
  assert.equal(effect.active(room, target), true);
  return { room, source, target };
}

for (const effect of effects) {
  for (const status of ['drunk', 'poison']) {
    test(`${effect.role} effect pauses while its source is ${status}, then returns in rules and views`, () => {
      const { room, source, target } = automatic(effect);
      ok(applyStOp(room, { op: 'setStatus', seatId: source.id, what: status, on: true }));
      assert.equal(effect.active(room, target), false);
      assert.equal(seatTags(room, target).includes(effect.tag), false);
      assert.equal(!!tagWhy(room, target)[effect.tag], false);
      const hidden = viewFor(room, { st: true }).st;
      assert.equal(hidden[effect.field], null);
      assert.equal(hidden[effect.list].includes(target.id), false);

      ok(applyStOp(room, { op: 'setStatus', seatId: source.id, what: status, on: false }));
      assert.equal(effect.active(room, target), true);
      assert.equal(seatTags(room, target).includes(effect.tag), true);
      const restored = viewFor(room, { st: true }).st;
      assert.equal(restored[effect.field], target.id);
      assert.equal(restored[effect.list].includes(target.id), true);
    });
  }

  test(`${effect.role} effect ends on source death and does not resume after revival`, () => {
    const { room, source, target } = automatic(effect);
    killSeat(room, source, '說書人手動標記');
    assert.equal(effect.active(room, target), false);
    revive(room, source);
    assert.equal(effect.active(room, target), false);
  });

  test(`${effect.role} effect ends on a role change and needs a new choice if changed back`, () => {
    const { room, source, target } = automatic(effect);
    changeRole(room, source, 'recluse', 'test');
    assert.equal(effect.active(room, target), false);
    changeRole(room, source, effect.role, 'test');
    assert.equal(effect.active(room, target), false);
  });

  test(`manual removal also clears a temporarily inactive ${effect.role} effect`, () => {
    const { room, source, target } = automatic(effect);
    ok(applyStOp(room, { op: 'setStatus', seatId: source.id, what: 'drunk', on: true }));
    ok(applyStOp(room, { op: 'setStatus', seatId: target.id, what: effect.kind, on: false }));
    assert.equal(room.g[effect.field], null);
    assert.equal(room.g[effect.field + 'By'], null);
    ok(applyStOp(room, { op: 'setStatus', seatId: source.id, what: 'drunk', on: false }));
    assert.equal(effect.active(room, target), false);
  });
}

test('manual poison replaces an automatic source, and old scalar marks remain compatible', () => {
  const effect = effects[0], { room, source, target } = automatic(effect);
  ok(applyStOp(room, { op: 'setPoison', seatId: target.id }));
  assert.equal(room.g.poisonedBy, null);
  killSeat(room, source, '說書人手動標記');
  assert.equal(isPoisoned(room, target), true);
  room.g.protected = target.id;
  delete room.g.protectedBy;
  assert.equal(monkProtects(room, target), true);
  startNight(room);
  assert.equal(room.g.poisonedBy, null);
  assert.equal(room.g.protectedBy, null);
  assert.equal(isPoisoned(room, target), false);
  assert.equal(monkProtects(room, target), false);
});

test('self-poison persists without recursion, but pauses for independent drunkenness', () => {
  const room = setup(['poisoner', 'imp', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
  const poisoner = S(room, 'poisoner');
  startNight(room);
  act(room, 'poisoner', [poisoner.id]);
  assert.equal(isPoisoned(room, poisoner), true);
  assert.equal(impaired(room, poisoner), true);
  ok(applyStOp(room, { op: 'setStatus', seatId: poisoner.id, what: 'drunk', on: true }));
  assert.equal(poisonerPoisons(room, poisoner), false);
  ok(applyStOp(room, { op: 'setStatus', seatId: poisoner.id, what: 'drunk', on: false }));
  assert.equal(isPoisoned(room, poisoner), true);
});

for (const role of ['sailor', 'innkeeper', 'courtier']) {
  test(`${role} self-drunkenness persists while its other effects are disabled`, () => {
    const room = setup([role, 'imp', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
    const source = S(room, role);
    room.phase = 'night';
    addEff(room, source.id, 'drunk', role, 100, source.id, { live: true });
    addEff(room, S(room, 'chef').id, 'protect', role, 100, source.id, { live: true });
    assert.equal(hasEff(room, source, 'drunk'), true);
    assert.equal(hasEff(room, S(room, 'chef'), 'protect'), false);
    addEff(room, source.id, 'poison', null, 100);
    assert.equal(hasEff(room, source, 'drunk'), false);
    dropEff(room, e => e.kind === 'poison');
    assert.equal(hasEff(room, source, 'drunk'), true);
    source.dead = true;
    assert.equal(hasEff(room, source, 'drunk'), false);
    source.dead = false;
    source.role = 'recluse';
    assert.equal(hasEff(room, source, 'drunk'), false);
  });
}

test('Vigormortis poison requires a dead retained Minion, whose own drunkenness does not disable it', () => {
  const room = setup(['vigormortis', 'witch', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
  const vigor = S(room, 'vigormortis'), minion = S(room, 'witch'), target = S(room, 'chef');
  room.phase = 'night';
  Object.assign(minion, { dead: true, keep: true });
  addEff(room, target.id, 'poison', 'vigormortis', 100, vigor.id, { live: true, minion: minion.id });
  assert.equal(isPoisoned(room, target), true);
  addEff(room, minion.id, 'drunk', null, 100);
  assert.equal(isPoisoned(room, target), true);
  addEff(room, vigor.id, 'drunk', null, 100);
  assert.equal(isPoisoned(room, target), false);
  dropEff(room, e => e.seat === vigor.id && e.kind === 'drunk');
  assert.equal(isPoisoned(room, target), true);
  minion.dead = false;
  assert.equal(isPoisoned(room, target), false);
  minion.dead = true;
  minion.keep = false;
  assert.equal(isPoisoned(room, target), false);
  minion.keep = true;
  minion.role = 'artist';
  assert.equal(isPoisoned(room, target), false);
});

test('a Poisoner killed by the Vigormortis keeps the poison already applied that night', () => {
  const room = setup(['vigormortis', 'poisoner', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
  room.scriptId = 'snv';
  const poisoner = S(room, 'poisoner'), target = S(room, 'chef');
  startNight(room);
  act(room, 'poisoner', [target.id]);
  assert.equal(poisonerPoisons(room, target), true);
  ok(applyPlayerAction(room, S(room, 'vigormortis').pid, { act: 'pick', ids: [poisoner.id] }));
  assert.equal(poisoner.dead, true);
  assert.equal(poisoner.keep, true);
  assert.equal(poisonerPoisons(room, target), true, 'retained Minion abilities keep their existing effects');
});

test('a retained dead Poisoner poisoning the Vigormortis cannot recurse through keptAbility', () => {
  const room = setup(['vigormortis', 'poisoner', 'chef', 'saint', 'soldier', 'baron', 'washerwoman']);
  room.scriptId = 'snv';
  const vigor = S(room, 'vigormortis'), poisoner = S(room, 'poisoner'), target = S(room, 'chef');
  Object.assign(poisoner, { dead: true, keep: true, keepBy: vigor.id });
  startNight(room);
  assert.equal(room.g.step.roleId, 'poisoner');
  ok(applyPlayerAction(room, poisoner.pid, { act: 'pick', ids: [vigor.id] }));
  assert.doesNotThrow(() => {
    isPoisoned(room, vigor);
    impaired(room, poisoner);
    keptAbility(room, poisoner);
    viewFor(room, { st: true });
  });

  // An independent disability has a definite result even in this source cycle.
  addEff(room, vigor.id, 'drunk', null, 100);
  assert.equal(keptAbility(room, poisoner), false);
  assert.equal(poisonerPoisons(room, vigor), false);
  room.g.poisoned = target.id;
  assert.equal(poisonerPoisons(room, target), false);
  dropEff(room, e => e.seat === vigor.id && e.kind === 'drunk');
  assert.equal(keptAbility(room, poisoner), true);
  assert.equal(poisonerPoisons(room, target), true);
});
