import assert from 'node:assert/strict';
import { startNight } from '../lib/engine.js';
import { applyPlayerAction } from '../lib/ops.js';
import { setup, S, ok, st, runOnly } from './helpers.js';

// 賭徒猜錯後只剩兩人，沙巴洛斯不能再自殺改變勝負。
{
  const room = setup(['gambler', 'shabaloth', 'chambermaid', 'assassin', 'grandmother']);
  room.scriptId = 'bmr';
  const gambler = S(room, 'gambler'), demon = S(room, 'shabaloth'), chambermaid = S(room, 'chambermaid');
  S(room, 'assassin').dead = S(room, 'grandmother').dead = true;
  startNight(room);
  assert.equal(room.g.step.roleId, 'gambler');
  ok(applyPlayerAction(room, gambler.pid, { act: 'pick', ids: [chambermaid.id], role: 'sailor' }));
  assert.equal(gambler.dead, true);
  assert.deepEqual([room.phase, room.winner], ['ended', 'evil']);
  assert.equal(room.g.step, null);
  assert.deepEqual(room.g.queue, []);
  assert.equal(typeof applyPlayerAction(room, demon.pid, { act: 'pick', ids: [demon.id, gambler.id] }), 'string');
  assert.equal(demon.dead, false);
}

// 小惡魔自殺後先完成同一次行動的傳位，再按剩下兩名活人判定邪惡獲勝。
{
  const room = setup(['imp', 'poisoner', 'baron', 'chef', 'saint']);
  const imp = S(room, 'imp'), heir = S(room, 'poisoner');
  S(room, 'chef').dead = S(room, 'saint').dead = true;
  await runOnly(room, 'imp', 2);
  ok(applyPlayerAction(room, imp.pid, { act: 'pick', ids: [imp.id] }));
  assert.equal(imp.dead, true);
  assert.equal(room.winner, null);
  assert.equal(room.g.step.decide.kind, 'starpass');
  ok(st(room, 'decide', { choice: heir.id }));
  assert.equal(heir.role, 'imp');
  assert.deepEqual([room.phase, room.winner], ['ended', 'evil']);
}

// 普卡被驅魔人選中時不會醒，上個中毒的人死亡仍會立刻結束對局。
{
  const room = setup(['pukka', 'exorcist', 'gambler', 'godfather', 'moonchild']);
  room.scriptId = 'bmr';
  const pukka = S(room, 'pukka'), exorcist = S(room, 'exorcist'), gambler = S(room, 'gambler');
  S(room, 'godfather').dead = S(room, 'moonchild').dead = true;
  room.g.pukka = gambler.id;
  startNight(room);
  assert.equal(room.g.step.roleId, 'gambler');
  ok(st(room, 'skip'));
  assert.equal(room.g.step.roleId, 'exorcist');
  ok(applyPlayerAction(room, exorcist.pid, { act: 'pick', ids: [pukka.id] }));
  ok(st(room, 'ack'));
  assert.equal(gambler.dead, true);
  assert.deepEqual([room.phase, room.winner], ['ended', 'evil']);
}
