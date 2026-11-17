// 個人規則：反芻只限自己上一晚親手殺死、目前仍死亡的玩家。
import assert from 'node:assert/strict';
import test from 'node:test';
import { startNight } from '../lib/engine.js';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { setup, S, ok, ack } from './helpers.js';

const makeRoom = roles => {
  const room = setup(roles);
  room.scriptId = 'bmr';
  return room;
};
const choose = (room, role, ids) => {
  assert.equal(room.g.step?.roleId, role);
  assert.equal(room.g.step?.status, 'choose');
  ok(applyPlayerAction(room, S(room, role).pid, { act: 'pick', ids }));
  ack(room);
};
const decide = (room, kind, choice) => {
  assert.equal(room.g.step?.decide?.kind, kind);
  ok(applyStOp(room, { op: 'decide', choice }));
  ack(room);
};
const nextNight = room => {
  assert.equal(room.g.step?.status, 'review');
  ok(applyStOp(room, { op: 'dawn' }));
  startNight(room);
};
const candidates = room => {
  assert.equal(room.g.step?.roleId, 'shabaloth');
  assert.equal(room.g.step?.decide?.kind, 'regurgitate');
  return room.g.step.decide.options.filter(o => o.id !== 'none').map(o => o.id);
};

test('House-rule Shabaloth revives its own kill, excluding an attacked corpse', () => {
  const room = makeRoom(['shabaloth', 'mastermind', 'tinker', 'minstrel', 'pacifist', 'grandmother', 'fool']);
  const corpse = S(room, 'minstrel'), victim = S(room, 'tinker');
  corpse.dead = true; // 白天已被處決的玩家。
  startNight(room);
  choose(room, 'shabaloth', [corpse.id, victim.id]);
  nextNight(room);
  assert.deepEqual(candidates(room), [victim.id]);
  assert.equal(typeof applyStOp(room, { op: 'decide', choice: corpse.id }), 'string', '已有死者不在合法候選中');
  decide(room, 'regurgitate', victim.id);
  assert.equal(victim.dead, false);
  assert.equal(corpse.dead, true);
  assert.equal(room.g.step.status, 'choose', '反芻後仍正常喚醒沙巴洛斯');
});

test('House-rule Shabaloth excludes a protected player later killed by the Assassin', () => {
  const room = makeRoom(['shabaloth', 'sailor', 'assassin', 'mastermind', 'tinker', 'minstrel', 'pacifist', 'grandmother', 'fool']);
  const sailor = S(room, 'sailor'), victim = S(room, 'minstrel'), drunk = S(room, 'tinker');
  startNight(room);
  choose(room, 'sailor', [drunk.id]);
  decide(room, 'drunk', drunk.id);
  choose(room, 'shabaloth', [sailor.id, victim.id]);
  assert.equal(sailor.dead, false, '清醒水手擋下沙巴洛斯的攻擊');
  choose(room, 'assassin', [sailor.id]);
  assert.equal(sailor.dead, true);
  nextNight(room);
  assert.deepEqual(candidates(room), [victim.id], '刺客造成的死亡不能算作沙巴洛斯親手殺死');
});

test('House-rule Shabaloth has no candidates after a drunken night, even when it chose corpses', () => {
  const room = makeRoom(['shabaloth', 'sailor', 'mastermind', 'tinker', 'minstrel', 'pacifist', 'grandmother', 'fool']);
  const demon = S(room, 'shabaloth'), a = S(room, 'tinker'), b = S(room, 'minstrel'), decoy = S(room, 'pacifist');
  startNight(room);
  choose(room, 'sailor', [decoy.id]);
  decide(room, 'drunk', decoy.id);
  choose(room, 'shabaloth', [a.id, b.id]);
  nextNight(room);
  choose(room, 'sailor', [demon.id]);
  decide(room, 'drunk', demon.id);
  assert.equal(room.g.step.status, 'choose', '當晚醉酒不反芻');
  choose(room, 'shabaloth', [a.id, b.id]);
  decide(room, 'ability', 'fail');
  nextNight(room);
  choose(room, 'sailor', [decoy.id]);
  decide(room, 'drunk', decoy.id);
  assert.equal(room.g.step.roleId, 'shabaloth');
  assert.equal(room.g.step.status, 'choose', '清醒後不能反芻醉酒夜未殺死的人，也不能沿用更早的死亡');
});

test('House-rule Shabaloth retains the first kill when its second attack hits the Goon', () => {
  const room = makeRoom(['shabaloth', 'goon', 'mastermind', 'tinker', 'minstrel', 'pacifist', 'grandmother', 'fool']);
  const victim = S(room, 'tinker'), goon = S(room, 'goon');
  startNight(room);
  choose(room, 'shabaloth', [victim.id, goon.id]);
  assert.equal(victim.dead, true);
  assert.equal(goon.dead, false);
  nextNight(room);
  assert.deepEqual(candidates(room), [victim.id], '選中莽夫前已完成的殺人仍可供次夜反芻');
});

test('House-rule Shabaloth excludes a Grandmother death caused by her own ability', () => {
  const room = makeRoom(['shabaloth', 'mastermind', 'tinker', 'minstrel', 'pacifist', 'grandmother', 'fool', 'goon']);
  const grandmother = S(room, 'grandmother'), child = S(room, 'tinker'), other = S(room, 'minstrel');
  room.g.grandchild = { [grandmother.id]: child.id };
  startNight(room);
  choose(room, 'shabaloth', [child.id, other.id]);
  assert.equal(grandmother.dead, true);
  nextNight(room);
  assert.deepEqual(candidates(room), [child.id, other.id], '祖母跟死不是沙巴洛斯親手殺死');
});
