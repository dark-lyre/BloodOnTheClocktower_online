import assert from 'node:assert/strict';
import { startNight } from '../lib/engine.js';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { aliveNeighbors, impaired, isGoodSeat } from '../lib/util.js';
import { setup, S, ok, ack } from './helpers.js';

// 七人局三刀後至少還有四人，避免只剩兩人時提前判勝掩蓋後續攻擊。
const roles = ['tinker', 'tealady', 'saint', 'po', 'mastermind', 'minstrel', 'pacifist'];
const scenarios = [
  { name: '茶藝師先死', order: ['tealady', 'saint', 'tinker'], results: ['kill', 'kill', 'kill'] },
  { name: '茶藝師第二刀死', order: ['saint', 'tealady', 'tinker'], results: ['blocked', 'kill', 'kill'] },
  { name: '茶藝師最後死', order: ['saint', 'tinker', 'tealady'], results: ['blocked', 'blocked', 'kill'] },
];

for (const bySt of [false, true]) {
  for (const scenario of scenarios) {
    const label = `${bySt ? '說書人代選' : '玩家選人'}：${scenario.name}`;
    const room = setup(roles);
    room.scriptId = 'bmr';
    const po = S(room, 'po'), tea = S(room, 'tealady');
    const pick = ids => ok(bySt
      ? applyStOp(room, { op: 'pick', ids })
      : applyPlayerAction(room, po.pid, { act: 'pick', ids }));

    // 真正提交「不選人」蓄力，再經過黎明、白天進入三刀夜。
    startNight(room);
    assert.equal(room.g.step.roleId, 'po', label);
    assert.ok(room.g.step.choose.counts.includes(0), label);
    pick([]);
    assert.equal(room.g.poCharge[po.id], true, label);
    ack(room);
    assert.equal(room.g.step.status, 'review', label);
    ok(applyStOp(room, { op: 'dawn' }));
    assert.equal(room.phase, 'day', label);
    ok(applyStOp(room, { op: 'next' }));
    assert.equal(room.g.step.roleId, 'po', label);
    assert.equal(room.g.step.choose.count, 3, label);

    assert.deepEqual(aliveNeighbors(room, tea).map(s => s.role).sort(), ['saint', 'tinker'], label);
    assert.ok(aliveNeighbors(room, tea).every(s => !s.dead && isGoodSeat(s)), label);
    assert.equal(impaired(room, tea), false, label);

    // 每例都故意不按座次排列；操作入口必須保留提交的點選順序。
    const ids = scenario.order.map(role => S(room, role).id);
    const requested = [...ids], chatFrom = room.chatSeq, logFrom = room.g.log.length, fxFrom = room.fxSeq;
    pick(ids);
    const step = room.g.step, each = step.result.e.each;
    assert.deepEqual(ids, requested, `${label}：不得改動請求陣列`);
    assert.deepEqual(room.g.lastPick[po.id], requested, label);
    assert.deepEqual(step.picks, requested, label);
    assert.deepEqual(step.result.e.to, requested, label);
    assert.deepEqual(each.map(x => x.id), requested, label);
    assert.deepEqual(each.map(x => x.res), scenario.results, label);
    assert.ok(each.filter(x => x.res === 'blocked').every(x => x.why === 'tealady'), label);
    assert.equal(room.g.poCharge[po.id], false, label);

    const killed = requested.filter((_, i) => scenario.results[i] === 'kill');
    for (const [i, role] of scenario.order.entries()) {
      assert.equal(S(room, role).dead, scenario.results[i] === 'kill', `${label}：${role}`);
    }
    assert.deepEqual(room.g.diedTonight, killed, `${label}：死亡順序`);
    assert.deepEqual(room.g.log.slice(logFrom).filter(l => l.e?.k === 'death').map(l => l.e.seat), killed, label);
    assert.deepEqual(room.g.log.slice(logFrom).find(l => l.e?.k === 'act' && l.e.src === 'po').e.to, requested, label);

    const message = room.chat.find(m => m.seq > chatFrom && m.to === po.id && m.k === 'act' && m.src === 'po');
    assert.ok(message, `${label}：保留玩家行動記錄`);
    assert.deepEqual(message.f.filter(x => x.s).map(x => x.s), requested, label);
    const effect = room.fx.find(e => e.seq > fxFrom && e.aud === po.id && e.k === 'act' && e.src === 'po');
    assert.ok(effect, `${label}：保留玩家行動演出`);
    assert.deepEqual(effect.to, requested, label);

    assert.equal(room.phase, 'night', label);
    assert.equal(room.winner, null, label);
    assert.ok(room.seats.filter(s => !s.dead).length >= 4, label);
    ack(room);
    assert.equal(room.g.step.status, 'review', label);
    console.log(`${label} ✔`);
  }
}
