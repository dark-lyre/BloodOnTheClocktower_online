// 莽夫因自身能力轉換陣營而被喚醒，侍女要計入；同陣營觸發、尚未觸發不算。
// 規則依據：https://wiki.bloodontheclocktower.com/Goon （How to Run）
// https://wiki.bloodontheclocktower.com/Chambermaid （Summary）
// 用法：node tests/goon-wake.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoom } from '../lib/store.js';
import { applyStOp, joinPlayer } from '../lib/ops.js';
import { startNight } from '../lib/engine.js';
import { alignOf, impaired } from '../lib/util.js';
import { viewFor } from '../lib/view.js';

const roles = ['poisoner', 'goon', 'chambermaid', 'imp', 'chef', 'saint'];
const op = (room, name, fields = {}) => {
  const result = applyStOp(room, { op: name, ...fields });
  assert.notEqual(typeof result, 'string', `${name}: ${result}`);
  return result;
};
const seat = (room, role) => room.seats.find(s => s.role === role);
const notices = room => room.chat.filter(m => m.info && m.k !== 'role' && m.to === seat(room, 'goon').id && m.src === 'goon');

function setup(venue, devices, initialAlign) {
  const room = createRoom();
  room.settings.pretend = false;
  op(room, 'venue', { venue, devices });
  op(room, 'upload', { entries: [{ id: '_meta', name: '莽夫與侍女' }, ...roles] });
  if (devices === 'one') op(room, 'addSeats', { names: roles.map((_, i) => `玩家${i + 1}`) });
  else roles.forEach((_, i) => assert.equal(joinPlayer(room, `p${i}`, `玩家${i + 1}`), undefined));
  roles.forEach((roleId, i) => op(room, 'setRole', { seatId: room.seats[i].id, roleId }));
  if (initialAlign) seat(room, 'goon').align = initialAlign;
  op(room, 'next');
  assert.equal(room.g.step.roleId, 'poisoner');
  return room;
}

function toChambermaid(room) {
  for (let i = 0; i < 20 && room.g.step?.roleId !== 'chambermaid'; i++) {
    assert.equal(room.phase, 'night');
    assert.notEqual(room.g.step?.status, 'review', '侍女之前不能已經天亮');
    // 只跳過其他角色的行動，不替侍女選人。
    op(room, 'skip');
  }
  assert.equal(room.g.step?.roleId, 'chambermaid');
  assert.equal(room.g.step.status, 'choose');
}

function chambermaidTruth(room) {
  op(room, 'pick', { ids: [seat(room, 'goon').id, seat(room, 'saint').id] });
  assert.equal(room.g.step.roleId, 'chambermaid');
  assert.equal(room.g.step.status, 'confirm');
  return room.g.step.form.truth.n;
}

for (const [venue, devices] of [['online', 'many'], ['offline', 'many'], ['offline', 'one']]) {
  const mode = `${venue}/${devices}`;

  test(`${mode}: 莽夫轉陣營在侍女之前告知，並計為自身能力喚醒`, () => {
    const room = setup(venue, devices);
    const goon = seat(room, 'goon'), poisoner = seat(room, 'poisoner');
    op(room, 'pick', { ids: [goon.id] });
    assert.equal(alignOf(goon), 'evil');
    assert.equal(impaired(room, poisoner), true);
    assert.equal(notices(room).length, 1);
    assert.match(notices(room)[0].text, /邪惡/);
    assert.equal(notices(room)[0].text.includes(poisoner.name), false, '只通知陣營，不公開選擇者');
    assert.equal(notices(room)[0].night, room.g.night);
    assert.equal(room.g.step.roleId, 'poisoner', '通知緊接觸發者的行動，不延至夜末');
    if (venue === 'offline') {
      assert.equal(room.g.step.status, 'ack', '線下必須停下來叫醒莽夫');
      assert(room.g.step.told?.some(t => t.seatId === goon.id && t.src === 'goon'));
      if (devices === 'many') {
        assert(viewFor(room, { pid: goon.pid }).chat.some(m => m.src === 'goon' && m.to === goon.id));
      }
    }
    toChambermaid(room);
    assert.equal(chambermaidTruth(room), 1, '侍女應看見莽夫因自己的能力醒來，聖徒沒有醒');
    assert.equal(room.g.woke.filter(id => id === goon.id).length, 1);
  });

  test(`${mode}: 同陣營選中仍使選擇者醉酒，但不叫醒莽夫、不增加侍女數字`, () => {
    const room = setup(venue, devices, 'evil');
    const goon = seat(room, 'goon');
    op(room, 'pick', { ids: [goon.id] });
    assert.equal(alignOf(goon), 'evil');
    assert.equal(impaired(room, seat(room, 'poisoner')), true);
    assert.equal(room.g.goonNight, room.g.night, '莽夫已觸發，只是陣營沒有改變');
    assert.equal(notices(room).length, 0);
    assert.equal(room.g.woke.includes(goon.id), false);
    assert.equal(room.g.step.told?.some(t => t.seatId === goon.id) || false, false);
    toChambermaid(room);
    assert.equal(chambermaidTruth(room), 0);
  });

  test(`${mode}: 未曾觸發莽夫時不預先喚醒；侍女首次選中同陣營莽夫也不算喚醒`, () => {
    const room = setup(venue, devices);
    const goon = seat(room, 'goon');
    op(room, 'pick', { ids: [seat(room, 'chef').id] });
    toChambermaid(room);
    assert.notEqual(room.g.goonNight, room.g.night);
    assert.equal(notices(room).length, 0);
    assert.equal(room.g.woke.includes(goon.id), false);
    assert.equal(chambermaidTruth(room), 0);
    assert.equal(notices(room).length, 0);
    assert.equal(room.g.woke.includes(goon.id), false);
  });
}

test('莽夫前一夜因轉陣營被喚醒，不會延續到下一夜的侍女數字', () => {
  const room = setup('online', 'many');
  const goon = seat(room, 'goon');
  op(room, 'pick', { ids: [goon.id] });
  toChambermaid(room);
  // 本測試只驗證下一夜的重置，先把當前信息卡按引擎計算的答案結束。
  chambermaidTruth(room);
  op(room, 'confirm', { fields: room.g.step.form.truth });
  assert.equal(room.g.step.status, 'review');
  op(room, 'dawn');
  startNight(room);
  assert.equal(room.g.woke.includes(goon.id), false);
  op(room, 'pick', { ids: [goon.id] });
  toChambermaid(room);
  assert.equal(chambermaidTruth(room), 0);
  assert.equal(notices(room).length, 1, '新夜未轉陣營，不新增通知');
});
