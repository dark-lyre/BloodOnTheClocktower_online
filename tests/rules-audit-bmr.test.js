import assert from 'node:assert/strict';
import test from 'node:test';
import { startNight } from '../lib/engine.js';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { changeRole } from '../lib/rules.js';
import { isPoisoned, isDrunk, poisonerPoisons } from '../lib/util.js';
import { setup, S, ok, ack } from './helpers.js';

const makeRoom = roles => {
  const room = setup(roles);
  room.scriptId = 'bmr';
  return room;
};
const expectStep = (room, role, status = 'choose') => {
  assert.equal(room.g.step?.roleId, role);
  assert.equal(room.g.step?.status, status);
};
const choose = (room, role, ids, character) => {
  expectStep(room, role);
  ok(applyPlayerAction(room, S(room, role).pid, { act: 'pick', ids, role: character }));
  ack(room);
};
const decide = (room, kind, choice) => {
  assert.equal(room.g.step?.decide?.kind, kind);
  ok(applyStOp(room, { op: 'decide', choice }));
};
const nextNight = room => {
  assert.equal(room.g.step?.status, 'review');
  ok(applyStOp(room, { op: 'dawn' }));
  startNight(room);
};

// https://wiki.bloodontheclocktower.com/Pukka — 新目標立即中毒，之後上一個中毒者死亡。
test('Pukka poisons the Grandmother before killing her Grandchild', () => {
  const room = makeRoom(['pukka', 'grandmother', 'gambler', 'mastermind', 'tinker', 'pacifist', 'fool']);
  const grandmother = S(room, 'grandmother'), child = S(room, 'gambler');
  room.g.grandchild = { [grandmother.id]: child.id };
  startNight(room);
  ok(applyStOp(room, { op: 'skip' })); // 賭徒不影響本次普卡結算。
  choose(room, 'pukka', [child.id]);
  assert.equal(isPoisoned(room, child), true);
  nextNight(room);
  ok(applyStOp(room, { op: 'skip' }));
  choose(room, 'pukka', [grandmother.id]);
  assert.equal(child.dead, true);
  assert.equal(grandmother.dead, false, '祖母此時已中毒，孫子被普卡殺死不應令祖母死亡');
  assert.equal(isPoisoned(room, grandmother), true);
});

// https://wiki.bloodontheclocktower.com/Abilities — 持續效果隨來源醉酒暫停，清醒後恢復。
test('Pukka poison pauses while the Pukka is drunk and resumes when healthy', () => {
  const room = makeRoom(['pukka', 'courtier', 'mastermind', 'fool', 'grandmother', 'tinker', 'pacifist']);
  const pukka = S(room, 'pukka'), target = S(room, 'fool');
  startNight(room);
  choose(room, 'courtier', []);
  choose(room, 'pukka', [target.id]);
  const before = isPoisoned(room, target);
  nextNight(room);
  choose(room, 'courtier', [], 'pukka');
  assert.equal(isDrunk(room, pukka), true);
  const whileDrunk = isPoisoned(room, target);
  ok(applyStOp(room, { op: 'setPoison', seatId: S(room, 'courtier').id }));
  assert.equal(isDrunk(room, pukka), false, '侍臣中毒讓普卡清醒');
  const after = isPoisoned(room, target);
  assert.deepEqual([before, whileDrunk, after], [true, false, true]);
});

// https://wiki.bloodontheclocktower.com/Abilities — 能力來源死亡，持續醉酒效果立即終止。
for (const source of ['sailor', 'innkeeper']) {
  test(`${source} drunkenness ends when the Assassin kills its source`, () => {
    const room = makeRoom([source, 'assassin', 'po', 'fool', 'pacifist', 'tinker', 'mastermind']);
    const target = S(room, 'fool');
    startNight(room);
    choose(room, source, source === 'innkeeper' ? [target.id, S(room, 'pacifist').id] : [target.id]);
    decide(room, 'drunk', target.id);
    assert.equal(isDrunk(room, target), true);
    choose(room, 'po', []);
    choose(room, 'assassin', [S(room, source).id]);
    assert.equal(S(room, source).dead, true);
    assert.equal(isDrunk(room, target), false, '使其醉酒的能力已隨來源死亡結束');
  });
}

// 個人規則只反芻上一晚親手殺死的人；被驅魔跳過的夜晚不沿用舊記錄。
test('Shabaloth cannot regurgitate stale targets after a night without choosing', () => {
  const room = makeRoom(['shabaloth', 'exorcist', 'mastermind', 'pacifist', 'tinker', 'grandmother', 'fool']);
  const demon = S(room, 'shabaloth'), decoy = S(room, 'pacifist');
  startNight(room);
  choose(room, 'exorcist', [decoy.id]);
  choose(room, 'shabaloth', [S(room, 'tinker').id, S(room, 'grandmother').id]);
  nextNight(room);
  choose(room, 'exorcist', [demon.id]);
  expectStep(room, 'shabaloth', 'decide');
  decide(room, 'regurgitate', 'none');
  nextNight(room);
  choose(room, 'exorcist', [decoy.id]);
  assert.notEqual(room.g.step?.decide?.kind, 'regurgitate', '昨晚未選人，不能繼續反芻前晚的目標');
  expectStep(room, 'shabaloth');
});

test('Pukka can keep the same player poisoned, then kill them while still poisoned', () => {
  const room = makeRoom(['pukka', 'mastermind', 'fool', 'pacifist', 'tinker']);
  const target = S(room, 'fool');
  startNight(room);
  choose(room, 'pukka', [target.id]);
  nextNight(room);
  choose(room, 'pukka', [target.id]);
  assert.equal(target.dead, false);
  assert.equal(isPoisoned(room, target), true);
  nextNight(room);
  choose(room, 'pukka', [S(room, 'pacifist').id]);
  assert.equal(target.dead, true, '舊目標在死亡時仍中毒，弄臣不能免死');
  assert.equal(room.g.used['fool:' + target.id], undefined, '弄臣的能力沒有被消耗');
  assert.equal(isPoisoned(room, target), false);
});

test('Pukka poisoning the Innkeeper removes protection before the old victim would die', () => {
  const room = makeRoom(['pukka', 'innkeeper', 'mastermind', 'fool', 'pacifist', 'tinker', 'grandmother']);
  const pukka = S(room, 'pukka'), innkeeper = S(room, 'innkeeper');
  const victim = S(room, 'fool'), pacifist = S(room, 'pacifist'), grandmother = S(room, 'grandmother');
  startNight(room);
  choose(room, 'innkeeper', [pukka.id, grandmother.id]);
  decide(room, 'drunk', grandmother.id);
  choose(room, 'pukka', [victim.id]);
  nextNight(room);
  choose(room, 'innkeeper', [victim.id, pacifist.id]);
  decide(room, 'drunk', pacifist.id);
  choose(room, 'pukka', [innkeeper.id]);
  assert.equal(isPoisoned(room, innkeeper), true);
  assert.equal(victim.dead, true, '新毒立即關閉旅店老闆的保護');
});

test('Innkeeper can save a previously poisoned player who then becomes healthy', () => {
  const room = makeRoom(['pukka', 'innkeeper', 'mastermind', 'fool', 'pacifist', 'tinker', 'grandmother']);
  const victim = S(room, 'fool'), pacifist = S(room, 'pacifist'), grandmother = S(room, 'grandmother');
  startNight(room);
  choose(room, 'innkeeper', [S(room, 'pukka').id, grandmother.id]);
  decide(room, 'drunk', grandmother.id);
  choose(room, 'pukka', [victim.id]);
  nextNight(room);
  choose(room, 'innkeeper', [victim.id, pacifist.id]);
  decide(room, 'drunk', pacifist.id);
  choose(room, 'pukka', [grandmother.id]);
  assert.equal(victim.dead, false);
  assert.equal(isPoisoned(room, victim), false, '被保護擋下死亡後，上一個目標的毒仍應移除');
  assert.equal(isPoisoned(room, grandmother), true);
});

test('Pukka self-poison prevents the later death and retains only the new poison', () => {
  const room = makeRoom(['pukka', 'mastermind', 'fool', 'pacifist', 'tinker']);
  const pukka = S(room, 'pukka'), old = S(room, 'fool');
  startNight(room);
  choose(room, 'pukka', [old.id]);
  nextNight(room);
  choose(room, 'pukka', [pukka.id]);
  assert.equal(isPoisoned(room, pukka), true, '自毒不能因自我依賴立即消失');
  assert.equal(old.dead, false, '新毒先使普卡失去能力，不能再殺上個目標');
  assert.equal(isPoisoned(room, old), false);
  assert.equal(room.g.pukka, pukka.id);
});

test('Pukka death while resolving a legacy previous target also removes the new poison', () => {
  const room = makeRoom(['pukka', 'mastermind', 'fool', 'pacifist', 'tinker']);
  const pukka = S(room, 'pukka'), target = S(room, 'fool');
  // 舊存檔或手動標記可能有上一個目標，但未記錄對應毒效果。
  room.g.pukka = pukka.id;
  startNight(room);
  choose(room, 'pukka', [target.id]);
  assert.equal(pukka.dead, true);
  assert.equal(isPoisoned(room, target), false, '新毒不能在來源已死亡後重新加入');
  assert.equal(room.g.pukka, null);
});

test('Pukka delayed Mayor ruling preserves the newly poisoned target', () => {
  const room = makeRoom(['pukka', 'mayor', 'mastermind', 'fool', 'pacifist', 'tinker']);
  const mayor = S(room, 'mayor'), target = S(room, 'fool');
  room.g.pukka = mayor.id; // 兼容只保存上一目標、沒有毒效果的舊存檔。
  startNight(room);
  choose(room, 'pukka', [target.id]);
  expectStep(room, 'pukka', 'decide');
  assert.equal(isPoisoned(room, target), true, '死亡裁定之前，新毒已生效');
  decide(room, 'mayor', mayor.id);
  assert.equal(mayor.dead, true);
  assert.equal(isPoisoned(room, target), true);
  assert.equal(room.g.pukka, target.id, '裁定後的清理不能刪掉下一個目標');
});

for (const source of ['sailor', 'innkeeper']) {
  test(`${source} drunkenness pauses for poisoning, resumes, and expires at dusk`, () => {
    const room = makeRoom([source, 'po', 'fool', 'pacifist', 'tinker', 'mastermind']);
    const actor = S(room, source), target = S(room, 'fool');
    startNight(room);
    choose(room, source, source === 'innkeeper' ? [target.id, S(room, 'pacifist').id] : [target.id]);
    decide(room, 'drunk', target.id);
    assert.equal(isDrunk(room, target), true);
    ok(applyStOp(room, { op: 'setPoison', seatId: actor.id }));
    assert.equal(isDrunk(room, target), false);
    ok(applyStOp(room, { op: 'setPoison', seatId: null }));
    assert.equal(isDrunk(room, target), true);
    choose(room, 'po', []);
    ok(applyStOp(room, { op: 'dawn' }));
    assert.equal(isDrunk(room, target), true, '醉酒持續至下個黃昏');
    startNight(room);
    assert.equal(isDrunk(room, target), false);
  });
}

test('Shabaloth ignores legacy selections that do not prove an actual kill', () => {
  const room = makeRoom(['shabaloth', 'exorcist', 'mastermind', 'pacifist', 'tinker', 'grandmother', 'fool']);
  const demon = S(room, 'shabaloth'), victim = S(room, 'tinker');
  victim.dead = true;
  room.g.shabaloth = [victim.id]; // 舊格式沒有 shabalothNight。
  startNight(room);
  choose(room, 'exorcist', [demon.id]);
  assert.notEqual(room.g.step?.decide?.kind, 'regurgitate');
  assert.equal(victim.dead, true);
  nextNight(room);
  choose(room, 'exorcist', [S(room, 'pacifist').id]);
  expectStep(room, 'shabaloth');
  assert.equal(room.g.step.decide, undefined);
});

// Assassin 的死亡不能被任何能力阻止，包含僵怖第一次的假死。
// https://wiki.bloodontheclocktower.com/Assassin — How to Run。
test('Assassin kills a healthy Zombuul for real on its first death', () => {
  const room = makeRoom(['zombuul', 'assassin', 'pacifist', 'grandmother', 'tinker']);
  const zombuul = S(room, 'zombuul');
  startNight(room);
  choose(room, 'zombuul', [S(room, 'tinker').id]);
  choose(room, 'assassin', [zombuul.id]);
  assert.equal(zombuul.dead, true);
  assert.equal(zombuul.undead, false);
  assert.equal(room.winner, 'good');
});

test('a poisoned Assassin cannot bypass the Zombuul ability', () => {
  const room = makeRoom(['zombuul', 'assassin', 'pacifist', 'grandmother', 'tinker']);
  const zombuul = S(room, 'zombuul');
  startNight(room);
  choose(room, 'zombuul', [S(room, 'tinker').id]);
  ok(applyStOp(room, { op: 'setPoison', seatId: S(room, 'assassin').id }));
  choose(room, 'assassin', [zombuul.id]);
  decide(room, 'ability', 'fail');
  assert.equal(zombuul.dead, false);
  assert.equal(room.winner, null);
});

test('a blocked Vigormortis attack does not preserve a Minion killed later by the Assassin', () => {
  const room = makeRoom(['vigormortis', 'poisoner', 'monk', 'assassin', 'chef', 'grandmother', 'saint']);
  const minion = S(room, 'poisoner'), target = S(room, 'chef');
  startNight(room);
  choose(room, 'poisoner', [target.id]);
  choose(room, 'monk', [minion.id]);
  choose(room, 'vigormortis', [minion.id]);
  assert.equal(minion.dead, false);
  assert.equal(!!minion.keep, false);
  choose(room, 'assassin', [minion.id]);
  assert.equal(minion.dead, true);
  assert.equal(!!minion.keep, false);
  assert.equal(poisonerPoisons(room, target), false);
});

test('Vigormortis preserves earlier poison when a Minion dies instead of the Mayor', () => {
  const room = makeRoom(['vigormortis', 'poisoner', 'chef', 'mayor', 'saint', 'mastermind', 'grandmother']);
  const minion = S(room, 'poisoner'), target = S(room, 'chef');
  startNight(room);
  choose(room, 'poisoner', [target.id]);
  choose(room, 'vigormortis', [S(room, 'mayor').id]);
  assert.equal(!!minion.keep, false, '尚未裁定死亡時不能提前保留能力');
  decide(room, 'mayor', minion.id);
  assert.equal(minion.dead, true);
  assert.equal(minion.keep, true);
  assert.equal(poisonerPoisons(room, target), true);
});

// https://wiki.bloodontheclocktower.com/Vigormortis — 主謀只有死前仍有能力，才適用亡骨魔死亡後保留能力的相剋。
for (const poisoned of ['vigormortis', 'mastermind']) {
  test(`an impaired ${poisoned} cannot preserve the dead Mastermind after the Vigormortis dies`, () => {
    const room = makeRoom(['vigormortis', 'mastermind', 'chef', 'monk', 'empath', 'mayor', 'soldier']);
    const demon = S(room, 'vigormortis'), mastermind = S(room, 'mastermind');
    startNight(room);
    choose(room, 'monk', [S(room, 'chef').id]);
    choose(room, 'vigormortis', [mastermind.id]);
    assert.equal(mastermind.dead, true);
    assert.equal(mastermind.keep, true);
    room.g.step = null; room.g.queue = []; room.phase = 'day';
    ok(applyStOp(room, { op: 'setPoison', seatId: S(room, poisoned).id }));
    ok(applyStOp(room, { op: 'execute', seatId: demon.id }));
    assert.equal(mastermind.keep, false);
    assert.equal(room.winner, 'good');
    assert.equal(!!room.g.mastermindDay, false);
  });
}

test('a Vigormortis changing character ends the dead Mastermind ability', () => {
  const room = makeRoom(['vigormortis', 'mastermind', 'chef', 'monk', 'empath', 'mayor', 'soldier']);
  const demon = S(room, 'vigormortis'), mastermind = S(room, 'mastermind');
  startNight(room);
  choose(room, 'monk', [S(room, 'chef').id]);
  choose(room, 'vigormortis', [mastermind.id]);
  assert.equal(mastermind.dead, true);
  assert.equal(mastermind.keep, true);
  changeRole(room, demon, 'imp', '測試換角');
  assert.equal(mastermind.keep, false);
  assert.equal(mastermind.keepBy, null);
});

// https://wiki.bloodontheclocktower.com/Abilities — 交換角色也會失去原能力及持續效果。
test('Barber swaps create fresh abilities without transferring old Courtier drunkenness', () => {
  const room = makeRoom(['vigormortis', 'courtier', 'barber', 'fool', 'pacifist', 'tinker', 'mastermind']);
  const courtier = S(room, 'courtier'), recipient = S(room, 'pacifist'), target = S(room, 'fool');
  const demon = S(room, 'vigormortis');
  startNight(room);
  choose(room, 'courtier', [], 'fool');
  assert.equal(isDrunk(room, target), true);
  choose(room, 'vigormortis', [S(room, 'barber').id]);
  expectStep(room, 'barber');
  ok(applyPlayerAction(room, demon.pid, { act: 'pick', ids: [courtier.id, recipient.id] }));
  ack(room);
  assert.equal(courtier.role, 'pacifist');
  assert.equal(recipient.role, 'courtier');
  assert.equal(isDrunk(room, target), false);
});

test('a new Pukka does not inherit the previous Pukka victim after a Barber swap', () => {
  const room = makeRoom(['pukka', 'assassin', 'barber', 'tinker', 'pacifist', 'grandmother', 'mastermind']);
  const demon = S(room, 'pukka'), recipient = S(room, 'pacifist'), target = S(room, 'tinker');
  startNight(room);
  choose(room, 'pukka', [target.id]);
  choose(room, 'assassin', [S(room, 'barber').id]);
  expectStep(room, 'barber');
  ok(applyPlayerAction(room, demon.pid, { act: 'pick', ids: [demon.id, recipient.id] }));
  ack(room);
  assert.equal(demon.role, 'pacifist');
  assert.equal(recipient.role, 'pukka');
  assert.equal(isPoisoned(room, target), false);
  assert.equal(room.g.pukka, null, '失去普卡能力時，上一個目標的記錄也結束');
  nextNight(room);
  choose(room, 'pukka', [S(room, 'grandmother').id]);
  assert.equal(target.dead, false, '新普卡首次行動不能殺死舊普卡已解毒的目標');
});
