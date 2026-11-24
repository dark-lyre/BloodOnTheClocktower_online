import assert from 'node:assert/strict';
import { createRoom } from '../lib/store.js';
import { applyPlayerAction, applyStOp, joinPlayer, WATCH } from '../lib/ops.js';
import { viewFor } from '../lib/view.js';
import { SCRIPTS } from '../public/js/roles.js';
import { goonHit } from '../lib/night.js';
import { tell } from '../lib/util.js';

// 載入前端遮罩時，語系和音效模組會初始化瀏覽器事件。
globalThis.addEventListener ??= () => {};
globalThis.document ??= { documentElement: { dataset: {} }, addEventListener: () => {} };
const { veiled } = await import('../public/js/veil.js');

const roles = ['zombuul', 'godfather', 'devilsadvocate', 'lunatic', 'marionette', 'goon', 'sailor', 'chambermaid', 'innkeeper', 'gambler'];
const ok = r => assert.strictEqual(r, undefined, r);
const st = (room, op, fields = {}) => applyStOp(room, { op, ...fields });
const host = room => viewFor(room, { st: true });
const player = (room, seat) => viewFor(room, { pid: seat.pid });
const say = (room, seat, to, text) => applyPlayerAction(room, seat.pid, { act: 'chat', to, text });
const routeFor = (view, label) => view.chatGroups.find(group => group.label === label)?.id;
const texts = (view, markers) => view.chat.filter(m => markers.includes(m.text)).map(m => m.text);

function pinRoles(room) {
  room.seats.forEach((seat, i) => {
    const roleId = roles[i];
    const fakeRole = roleId === 'lunatic' ? 'zombuul' : roleId === 'marionette' ? 'pacifist' : undefined;
    ok(st(room, 'setRole', { seatId: seat.id, roleId, fakeRole }));
  });
}

function setup(venue, devices) {
  const room = createRoom();
  ok(st(room, 'venue', { venue, devices }));
  const script = [{ id: '_meta', name: '群聊測試' }, ...SCRIPTS.bmr.roles, 'marionette'];
  assert.strictEqual(typeof st(room, 'upload', { entries: script }), 'object');
  if (devices === 'one') ok(st(room, 'addSeats', { names: roles.map((_, i) => `玩家${i}`) }));
  else roles.forEach((_, i) => ok(joinPlayer(room, `p${i}`, `玩家${i}`)));
  pinRoles(room);
  return room;
}

function finishInfo(room) {
  for (let i = 0; i < 8 && ['minioninfo', 'lunainfo', 'demoninfo'].includes(room.g.step?.roleId); i++) {
    const step = room.g.step;
    if (step.lunaticDraft) ok(st(room, 'lunaticInfo', { ...step.lunaticDraft, stepId: step.id }));
    else ok(st(room, 'ack'));
  }
  assert(!['minioninfo', 'lunainfo', 'demoninfo'].includes(room.g.step?.roleId));
}

function start(room, minions = room.seats.slice(1, 3).map(s => s.id)) {
  ok(st(room, 'next'));
  // 有瘋子時先確認假信息，所有玩家的角色才會一起發送。
  const step = room.g.step;
  if (step?.prepareLunatic) {
    assert.deepEqual(host(room).chatGroups, [], '準備瘋子信息時說書人也不提前開群聊');
    for (const seat of room.seats) {
      const view = player(room, seat);
      assert.equal(view.myRole, null);
      assert.deepEqual(view.chatGroups, [], '身份發送前不從群聊入口洩露陣營');
    }
    ok(st(room, 'lunaticInfo', { ...step.lunaticDraft, minions, stepId: step.id }));
  }
  finishInfo(room);
}

for (const venue of ['online', 'offline']) {
  const room = setup(venue, 'many');
  const [demon, minion, otherMinion, lunatic, marionette, goon, sailor] = room.seats;
  assert.deepEqual(host(room).chatGroups, [], '準備階段不開群聊');
  assert.deepEqual(player(room, demon).chatGroups, [], '預覽不暴露陣營');
  start(room);

  if (venue === 'offline') {
    const groups = host(room).chatGroups;
    for (let i = 0; i < 8 && !room.g.lunaticPending; i++) ok(st(room, 'undo'));
    assert(room.g.lunaticPending, '撤銷退回瘋子假信息準備');
    assert.deepEqual(host(room).chatGroups, groups, '已發身份不能收回，撤銷也不關閉群聊');
    assert(routeFor(player(room, demon), '陣營群聊'));
    const step = room.g.step;
    ok(st(room, 'lunaticInfo', { ...step.lunaticDraft, stepId: step.id }));
  }

  const hostEvil = routeFor(host(room), '邪惡群聊'), hostLuna = routeFor(host(room), '瘋子群聊');
  const evil = routeFor(player(room, demon), '陣營群聊');
  const minionEvil = routeFor(player(room, minion), '陣營群聊'), minionLuna = routeFor(player(room, minion), '群聊');
  const luna = routeFor(player(room, lunatic), '陣營群聊');
  assert.deepEqual(player(room, lunatic).chatGroups.map(g => g.label), player(room, demon).chatGroups.map(g => g.label), '瘋子的群聊標題和真惡魔一樣');
  const visibleIds = [hostEvil, hostLuna, evil, minionEvil, minionLuna, luna];
  assert(visibleIds.every(id => /^group-[a-f0-9]+$/.test(id)), '群聊路由不使用帶角色暗示的名稱');
  assert.equal(new Set(visibleIds).size, visibleIds.length, '路由在群聊和視角之間隔離');
  for (const v of [host(room), player(room, minion), player(room, lunatic)]) {
    assert(v.chatGroups.every(g => Object.keys(g).sort().join() === 'id,label'), '群聊資料不公開成員名冊');
  }
  for (const seat of [marionette, goon, sailor]) assert.deepEqual(player(room, seat).chatGroups, []);

  const spectator = 'late';
  assert.equal(joinPlayer(room, spectator, '觀眾'), WATCH);
  assert.deepEqual(viewFor(room, { pid: spectator }).chatGroups, []);
  for (const [seat, to] of [[demon, hostEvil], [demon, luna], [minion, luna], [lunatic, evil], [marionette, evil], [sailor, evil], [{ pid: spectator }, evil]]) {
    assert.equal(typeof say(room, seat, to, '不應發送'), 'string', '猜到別的視角的路由也不能發送');
  }
  assert.equal(typeof applyPlayerAction(room, sailor.pid, { act: 'chat', to: evil, text: '偽裝發件人', from: demon.id, audience: [sailor.id] }), 'string');
  assert(!room.chat.some(m => m.text === '不應發送' || m.text === '偽裝發件人'));

  const tags = ['給邪惡成員', '給瘋子和爪牙', '爪牙回真群', '爪牙回假群', '主持真群', '主持假群'];
  ok(say(room, demon, evil, tags[0]));
  ok(say(room, lunatic, luna, tags[1]));
  ok(say(room, minion, minionEvil, tags[2]));
  ok(say(room, minion, minionLuna, tags[3]));
  ok(st(room, 'chat', { to: hostEvil, text: tags[4] }));
  ok(st(room, 'chat', { to: hostLuna, text: tags[5] }));
  assert.deepEqual(texts(host(room), tags), tags, '說書人讀到兩個群的全文');
  assert.deepEqual(texts(player(room, demon), tags), [tags[0], tags[2], tags[4]]);
  assert.deepEqual(texts(player(room, lunatic), tags), [tags[1], tags[3], tags[5]]);
  for (const seat of [minion, otherMinion]) assert.deepEqual(texts(player(room, seat), tags), tags);
  for (const seat of [marionette, goon, sailor, { pid: spectator }]) assert.deepEqual(texts(player(room, seat), tags), []);
  if (venue === 'offline') {
    const ctx = { ls: { get: () => null } }; // 線下手機沒有改過設置，預設遮住身份
    for (const seat of [demon, minion, lunatic]) {
      const view = player(room, seat), covered = veiled(ctx, view, false);
      assert.equal(covered.veiled, true);
      assert.equal(covered.myRole, null);
      assert(view.chat.some(m => m.info && m.to === seat.id));
      assert(!covered.chat.some(m => m.info && m.to === seat.id));
      assert.deepEqual(covered.chatGroups, view.chatGroups, '身份遮罩不拿走群聊入口');
      assert.deepEqual(texts(covered, tags), texts(view, tags), '身份遮罩不隱藏群聊消息');
    }
  }
  for (const [seat, groupId, text] of [[demon, evil, tags[4]], [minion, minionLuna, tags[5]], [lunatic, luna, tags[1]]]) {
    const sent = player(room, seat).chat.find(m => m.text === text);
    assert.equal(sent.to, groupId, '只發出收件人在本視角使用的路由');
    assert(!Object.hasOwn(sent, 'audience'), '不附上服務器留存的成員名冊');
    assert(visibleIds.filter(id => id !== groupId).every(id => !JSON.stringify(sent).includes(id)));
  }

  ok(st(room, 'setAlign', { seatId: goon.id, align: 'evil' }));
  assert.deepEqual(player(room, goon).chatGroups, [], '莽夫轉邪不獲得邪惡群聊');
  assert.deepEqual(texts(player(room, goon), tags), [], '莽夫看不到邪惡群聊歷史');
  ok(say(room, demon, evil, '入群後的新消息'));
  assert.deepEqual(texts(player(room, goon), ['入群後的新消息']), [], '莽夫轉邪也收不到新邪惡群聊');
  assert.equal(typeof say(room, goon, evil, '莽夫猜測群聊'), 'string');
  ok(st(room, 'setAlign', { seatId: goon.id, align: 'good' }));
  assert.deepEqual(player(room, goon).chatGroups, []);
  assert.deepEqual(texts(player(room, goon), ['入群後的新消息']), []);

  ok(st(room, 'setRole', { seatId: sailor.id, roleId: 'assassin' }));
  assert.deepEqual(player(room, sailor).chatGroups.map(g => g.label), ['陣營群聊'], '新爪牙不會自動成為假爪牙');
  assert.deepEqual(texts(player(room, sailor), tags), [], '新爪牙不補發兩個群的舊聊天');
  ok(st(room, 'setRole', { seatId: lunatic.id, roleId: 'fool' }));
  assert.deepEqual(player(room, lunatic).chatGroups, [], '沒有瘋子後關閉其群聊');
  assert.deepEqual(player(room, minion).chatGroups.map(g => g.label), ['陣營群聊']);

  ok(st(room, 'abandon'));
  assert.deepEqual(host(room).chatGroups, []);
  pinRoles(room);
  start(room);
  assert.notEqual(routeFor(player(room, demon), '陣營群聊'), evil, '新局重新分配群聊路由');
  assert.deepEqual(texts(host(room), tags), [], '上一局群聊清空');
  assert.equal(typeof say(room, demon, evil, '上一局的群'), 'string');
}

// 假爪牙可以是善良玩家：收發、歷史和存檔均按已發出的假信息隔離。
for (const venue of ['online', 'offline']) {
  const room = setup(venue, 'many');
  const [demon, minion, otherMinion, lunatic, marionette, goon, sailor, chambermaid] = room.seats;
  start(room, [sailor.id, chambermaid.id]);
  const hostLuna = routeFor(host(room), '瘋子群聊');
  const luna = routeFor(player(room, lunatic), '陣營群聊');
  assert(hostLuna && luna);
  for (const member of [sailor, chambermaid]) {
    assert.deepEqual(player(room, member).chatGroups.map(g => g.label), ['群聊'], '假爪牙只看到中性群名');
  }
  for (const member of [demon, minion, otherMinion]) {
    assert.deepEqual(player(room, member).chatGroups.map(g => g.label), ['陣營群聊'], '沒被指定的真邪惡不能進假群');
  }
  for (const outsider of [marionette, goon]) assert.deepEqual(player(room, outsider).chatGroups, []);

  const markers = ['假惡魔發言', '善良假爪牙回覆', '說書人寄假群', '真邪惡的私聊'];
  ok(say(room, lunatic, luna, markers[0]));
  ok(say(room, sailor, routeFor(player(room, sailor), '群聊'), markers[1]));
  ok(st(room, 'chat', { to: hostLuna, text: markers[2] }));
  ok(say(room, demon, routeFor(player(room, demon), '陣營群聊'), markers[3]));
  for (const member of [lunatic, sailor, chambermaid]) assert.deepEqual(texts(player(room, member), markers), markers.slice(0, 3));
  for (const outsider of [demon, minion, otherMinion]) {
    assert.deepEqual(texts(player(room, outsider), markers), markers.slice(3));
    assert.equal(typeof say(room, outsider, luna, '未指定爪牙嘗試入群'), 'string');
  }

  const longGame = JSON.parse(JSON.stringify(room));
  assert.equal(longGame.g.lunaticInfo.sent, true, '只在實際發送後保存正式群聊名單');
  for (let i = 0; i < 601; i++) tell(longGame, lunatic.id, `後續私密信息${i}`, [], { src: 'chambermaid' });
  assert(!longGame.chat.some(m => m.to === lunatic.id && m.src === 'demoninfo'), '確實超過聊天信息上限並裁掉首夜消息');
  assert(routeFor(player(longGame, lunatic), '陣營群聊'));
  for (const member of [sailor, chambermaid]) assert(routeFor(player(longGame, member), '群聊'), '長局仍使用已發送的固定名單');
  for (const outsider of [demon, minion, otherMinion]) assert(!routeFor(player(longGame, outsider), '群聊'));

  // 陣營、死亡不改變已經告訴瘋子的同伴；後來的草稿也不能替換已發信息。
  ok(st(room, 'setAlign', { seatId: chambermaid.id, align: 'evil' }));
  sailor.dead = true;
  room.g.lunaticInfo = { seatId: lunatic.id, minions: [minion.id, otherMinion.id] };
  assert(routeFor(player(room, chambermaid), '群聊'));
  assert(routeFor(player(room, sailor), '群聊'));
  assert(!routeFor(player(room, minion), '群聊'));
  const restored = JSON.parse(JSON.stringify(room));
  for (const member of [lunatic, sailor, chambermaid]) {
    assert.deepEqual(texts(player(restored, member), markers), markers.slice(0, 3), '讀取存檔後仍按已發名單收取歷史');
  }
  const missing = JSON.parse(JSON.stringify(room));
  missing.chat = missing.chat.filter(m => !(m.to === lunatic.id && m.src === 'demoninfo'));
  assert.deepEqual(player(missing, lunatic).chatGroups, [], '缺少已發名單時不猜測真爪牙或使用新草稿');
}

// 被指定為假爪牙的莽夫可以留在該群，但其能力轉邪不增加真邪惡群或通知隊友。
{
  const room = setup('online', 'many');
  const [demon, minion, otherMinion, lunatic, , goon, sailor] = room.seats;
  start(room, [goon.id, sailor.id]);
  const before = player(room, goon).chatGroups;
  assert.deepEqual(before.map(g => g.label), ['群聊']);
  const seq = room.chatSeq;
  goonHit(room, demon, [goon]);
  assert.equal(goon.align, 'evil');
  assert.deepEqual(player(room, goon).chatGroups, before, '莽夫只有原先被指定的假爪牙群');
  assert(room.g.woke.includes(goon.id));
  const told = player(room, goon).chat.filter(m => m.seq > seq && m.src === 'goon');
  assert.equal(told.length, 1);
  assert.match(told[0].text, /你的陣營變為邪惡/);
  assert.deepEqual(told[0].marks, [], '只通知新陣營，不提供選中者或同伴');
  for (const seat of [demon, minion, otherMinion, lunatic, sailor]) {
    assert(!player(room, seat).chat.some(m => m.seq > seq && m.src === 'goon'), '不把陣營通知寄給其他玩家');
  }
  const groupId = routeFor(player(room, demon), '陣營群聊');
  ok(say(room, demon, groupId, '莽夫不能收到的邪惡消息'));
  assert(!player(room, goon).chat.some(m => m.text === '莽夫不能收到的邪惡消息'));
  assert.equal(typeof say(room, goon, groupId, '不能向真邪惡群發言'), 'string');

  // 下一晚由善良玩家選中，仍只通知莽夫，指定群聊不隨陣營進退。
  room.g.night++;
  const nextSeq = room.chatSeq;
  goonHit(room, sailor, [goon]);
  assert.equal(goon.align, 'good');
  assert.deepEqual(player(room, goon).chatGroups, before);
  assert.match(player(room, goon).chat.find(m => m.seq > nextSeq && m.src === 'goon').text, /你的陣營變為善良/);
  for (const seat of [demon, minion, otherMinion, lunatic, sailor]) {
    assert(!player(room, seat).chat.some(m => m.seq > nextSeq && m.src === 'goon'));
  }
}

const single = setup('offline', 'one');
ok(st(single, 'next'));
assert.deepEqual(host(single).chatGroups, [], '單設備不需要開玩家群聊');
console.log('group chat access, isolation and lifecycle ok');
