import assert from 'node:assert/strict';
import { startNight } from '../lib/engine.js';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { viewFor } from '../lib/view.js';
import { setup, S, ok, ack } from './helpers.js';

// 造謠者的夜晚步驟是說書人結算，能力殺人也不需要叫醒本人。
// 走自然夜序，不直接填寫 woke 或改寫隊列，最後確認侍女實際收到的數字。
for (const statement of ['true', 'false', 'none']) {
  for (const otherRole of ['grandmother', 'gambler']) {
    const context = `${statement}, gossip + ${otherRole}`;
    const room = setup(['gossip', 'chambermaid', 'gambler', 'po', 'mastermind', 'grandmother', 'tinker']);
    room.scriptId = 'bmr';
    const gossip = S(room, 'gossip'), chambermaid = S(room, 'chambermaid');
    const gambler = S(room, 'gambler'), grandmother = S(room, 'grandmother'), victim = S(room, 'tinker');
    const stepIs = (roleId, status) => {
      assert.equal(room.g.step?.roleId, roleId, context);
      assert.equal(room.g.step?.status, status, context);
    };
    const gossipDecide = (kind, choice) => {
      stepIs('gossip', 'decide');
      assert.equal(room.g.step.decide.kind, kind, context);
      assert.equal(room.g.step.turn, false, '造謠裁定不是玩家夜晚行動');
      assert.equal(viewFor(room, { pid: gossip.pid }).prompt, null, '造謠者不收到夜晚選擇提示');
      ok(applyStOp(room, { op: 'decide', choice }));
    };

    startNight(room);
    assert.equal(room.g.night, 2);
    stepIs('gambler', 'choose');
    ok(applyPlayerAction(room, gambler.pid, { act: 'pick', ids: [grandmother.id], role: 'grandmother' }));
    ack(room);
    assert.equal(gambler.dead, false, '賭徒正常醒來並猜對，作為計數對照');

    stepIs('po', 'choose');
    ok(applyPlayerAction(room, S(room, 'po').pid, { act: 'pick', ids: [] }));
    ack(room); // 珀蓄力，這晚只有正確造謠能造成死亡。

    gossipDecide('gossip-made', statement === 'none' ? 'no' : 'yes');
    if (statement !== 'none') gossipDecide('gossip-truth', statement);
    if (statement === 'true') gossipDecide('gossip', victim.id);
    assert.equal(victim.dead, statement === 'true', context);
    assert.deepEqual(room.g.diedTonight, statement === 'true' ? [victim.id] : [], context);

    // 祖母在第二夜不醒；換成正常行動過的賭徒時應只多出 1。
    stepIs('chambermaid', 'choose');
    const ids = [gossip.id, S(room, otherRole).id], expected = otherRole === 'gambler' ? 1 : 0;
    ok(applyPlayerAction(room, chambermaid.pid, { act: 'pick', ids }));
    stepIs('chambermaid', 'confirm');
    assert.equal(room.g.step.form.truth.n, expected, context);
    assert.match(applyStOp(room, { op: 'confirm', fields: { n: 1 - expected } }), /只能給合規信息/, context);
    ok(applyStOp(room, { op: 'confirm', fields: { n: expected } }));

    const information = viewFor(room, { pid: chambermaid.pid }).chat.filter(m => m.info && m.src === 'chambermaid');
    assert.equal(information.length, 1, context);
    assert.deepEqual(information[0].f.filter(t => Object.hasOwn(t, 'n')).map(t => t.n), [expected], context);
    assert.deepEqual(information[0].f.filter(t => t.s).map(t => t.s), ids, context);
    assert.equal(room.g.step.status, 'review', context);
  }
}

console.log('gossip wake regressions ok (6 scenarios)');
