// 說書人發出的能力信息，同一條消息同時留在玩家信息面板和雙方私聊，且不洩露給其他人。
import assert from 'node:assert/strict';
import { createRoom } from '../lib/store.js';
import { applyStOp, joinPlayer } from '../lib/ops.js';
import { viewFor } from '../lib/view.js';
import { run } from '../lib/engine.js';
import { setup, runOnly, st, ok } from './helpers.js';

globalThis.addEventListener ??= () => {};
globalThis.document ??= { documentElement: { dataset: {} }, addEventListener: () => {} };
// 只需最小 DOM 介面，讓側欄渲染實際更新頻道的已讀位置。
globalThis.Node ??= class { append() {} setAttribute() {} hasAttribute() { return false; } };
document.createElement ??= () => new Node();
document.createElementNS ??= () => new Node();
document.createTextNode ??= () => new Node();
globalThis.matchMedia ??= query => ({ matches: query.includes('prefers-reduced-motion') });
globalThis.window ??= { matchMedia };
const { chatMessages, chatUnread, resetSide, renderSide, openChat, infoMarksBySeat, actMarksBySeat } = await import('../public/js/side.js');
const { hudRows } = await import('../public/js/hud.js');
const { veiled } = await import('../public/js/veil.js');

function assertPrivateInfo(room, seat, text) {
  const mine = viewFor(room, { pid: seat.pid });
  const host = viewFor(room, { st: true });
  const matches = messages => messages.filter(m => m.text === text);
  const messages = matches(chatMessages(mine, 'st'));
  assert.equal(messages.length, 1, '玩家與說書人的私聊中保留一條信息');
  assert.equal(matches(chatMessages(host, seat.id)).length, 1, '說書人與玩家的私聊也有信息');
  assert.equal(matches(hudRows(mine)).length, 1, '信息面板仍保留同一條信息');
  assert.equal(matches(room.chat).length, 1, '服務端不另寫重複的聊天消息');
  assert.equal(messages[0].info, true);
  assert.equal(messages[0].from, 'st');
  assert.equal(messages[0].to, seat.id);
  for (const other of room.seats.filter(s => s !== seat)) {
    assert.equal(matches(viewFor(room, { pid: other.pid }).chat).length, 0, '其他玩家看不到信息');
  }
  assert.equal(matches(viewFor(room, { pid: 'watcher' }).chat).length, 0, '觀眾看不到信息');

  const covered = veiled({ ls: { get: () => '1' } }, mine);
  assert.equal(matches(chatMessages(covered, 'st')).length, 1, '遮住身份后仍可在私聊查阅能力信息');
  assert.equal(matches(hudRows(covered)).length, 0, '桌面信息面板继续遮住');
  assert.equal(covered.myRole, null);
  assert.deepEqual(infoMarksBySeat(covered), {}, '桌面能力信息标记继续遮住');
  assert.deepEqual(actMarksBySeat(covered), {}, '桌面行动标记继续遮住');
  const offline = veiled({ ls: { get: () => null } }, { ...mine, offline: true });
  assert.equal(offline.veiled, true, '线下玩家默认遮住身份');
  assert.equal(matches(chatMessages(offline, 'st')).length, 1, '默认线下遮罩也不会吞掉私聊信息');
  assert.equal(matches(hudRows(offline)).length, 0);
  assert.equal(matches(chatMessages(veiled({ ls: { get: () => '0' } }, mine), 'st')).length, 1, '解除遮罩後可查閱信息');
}

// 正常夜晚的「發送信息」：經過能力表單、tell、身份過濾，再進入聊天頁。
{
  const room = setup(['chef', 'imp', 'poisoner', 'saint', 'soldier']);
  const chef = room.seats[0];
  const step = await runOnly(room, 'chef');
  assert.equal(step.status, 'confirm');
  const seq = room.chatSeq;
  ok(st(room, 'confirm', { fields: step.form.truth }));
  const sent = room.chat.find(m => m.seq > seq && m.to === chef.id && m.src === 'chef');
  assert(sent);
  assertPrivateInfo(room, chef, sent.text);

  // 手動補發沿用同一條信息通道。
  const text = '補充信息：你得到的數字為一。';
  ok(st(room, 'tellInfo', { seatId: chef.id, text }));
  assertPrivateInfo(room, chef, text);
}

// 新反饋照普通私聊提示未讀；遮住身份时不预览正文，打开私聊仍能查阅并清除未读。
{
  const room = setup(['chef', 'imp', 'poisoner', 'saint', 'soldier']);
  room.phase = 'day';
  const seat = room.seats[0];
  const ctx = { state: viewFor(room, { pid: seat.pid }), ls: { get: () => null, set: () => {} } };
  ctx.render = () => renderSide(ctx);
  resetSide();
  ctx.render();
  assert.deepEqual(chatUnread(ctx.state), {}, '剛載入的舊信息不重複提示');
  ok(st(room, 'tellInfo', { seatId: seat.id, text: '新的私密反饋' }));
  ctx.state = viewFor(room, { pid: seat.pid });
  assert.equal(chatUnread(ctx.state).st?.n, 1, '新反饋計入說書人私聊未讀');
  const covered = veiled({ ls: { get: () => '1' } }, ctx.state);
  assert.equal(chatUnread(covered).st?.n, 1, '遮罩下也提示私聊未读');
  assert.equal(chatUnread(covered).st.last.text, null, '桌面气泡不泄露被遮住的信息正文');
  ctx.state = covered;
  openChat(ctx, 'st');
  assert.deepEqual(chatUnread(ctx.state), {}, '打開私聊後清除未讀');
  assert(chatMessages(ctx.state, 'st').some(m => m.text === '新的私密反饋'), '讀後仍保留聊天記錄');
}

// 祖母首夜信息：线下默认遮罩、角色发送、反馈发送及刷新后，玩家私聊始终保留同一条消息。
{
  const room = createRoom();
  ok(st(room, 'venue', { venue: 'offline', devices: 'many' }));
  ok(st(room, 'script', { scriptId: 'bmr' }));
  const roles = ['zombuul', 'godfather', 'grandmother', 'gambler', 'minstrel', 'sailor', 'tealady'];
  roles.forEach((roleId, i) => {
    ok(joinPlayer(room, 'grandma-' + i, '玩家' + i));
    ok(st(room, 'setRole', { seatId: room.seats[i].id, roleId }));
  });
  ok(st(room, 'next'));
  const grandma = room.seats[2], grandson = room.seats[4];
  const cover = () => veiled({ ls: { get: () => null } }, viewFor(room, { pid: grandma.pid }));
  let state = cover();
  assert(state.veiled);
  assert(chatMessages(state, 'st').some(m => m.k === 'role' && m.src === 'grandmother'), '初始身份可从私聊查阅');
  room.g.step = null;
  room.g.queue = [{ roleId: 'grandmother', seatId: grandma.id, at: 1 }];
  run(room);
  assert.equal(room.g.step.decide.kind, 'grandchild');
  ok(st(room, 'decide', { choice: grandson.id }));
  assert.equal(room.g.step.status, 'confirm');
  ok(st(room, 'confirm', { fields: room.g.step.form.truth }));
  const feedback = room.chat.find(m => m.to === grandma.id && m.src === 'grandmother' && m.k !== 'role');
  assert(feedback);
  state = cover();
  assert.equal(chatMessages(state, 'st').filter(m => m.seq === feedback.seq).length, 1);
  assert.equal(state.myRole, null);
  assert.deepEqual(infoMarksBySeat(state), {}, '祖母得知的角色不会透过桌面标记泄露');
  resetSide();
  const ctx = { state: cover(), ls: { get: () => null, set: () => {} } };
  ctx.render = () => renderSide(ctx);
  ctx.render();
  openChat(ctx, 'st');
  assert(chatMessages(ctx.state, 'st').some(m => m.seq === feedback.seq), '刷新后打开私聊仍能查阅祖母信息');
  assert.deepEqual(chatUnread(ctx.state), {}, '刷新时已有信息不会重复算未读');
  for (const seat of room.seats.filter(s => s !== grandma)) {
    assert(!chatMessages(veiled({ ls: { get: () => null } }, viewFor(room, { pid: seat.pid })), 'st').some(m => m.seq === feedback.seq));
  }
}

// 自製角色的標記步驟：發送後收起「輪到你了」，信息仍能從私聊查到。
{
  const room = createRoom();
  room.settings.pretend = false;
  const entries = ['imp', 'poisoner', 'chef', 'saint', {
    id: 'messenger', name: '測試信使', team: 'townsfolk', ability: '每晚，你會得知一個秘密。', firstNight: 60,
  }];
  assert.equal(typeof applyStOp(room, { op: 'upload', entries }), 'object');
  const custom = room.script.roles.at(-1);
  [custom, 'imp', 'poisoner', 'chef', 'saint'].forEach((roleId, i) => {
    ok(joinPlayer(room, 'custom-' + i, '玩家' + i));
    ok(st(room, 'setRole', { seatId: room.seats[i].id, roleId }));
  });
  ok(st(room, 'next'));
  const seat = room.seats[0];
  room.phase = 'night';
  room.g.step = null;
  room.g.queue = [{ roleId: custom, seatId: seat.id, at: 60 }];
  run(room);
  assert.equal(room.g.step.status, 'mark');
  assert.equal(viewFor(room, { pid: seat.pid }).prompt.wake, true);
  const text = '自製角色的秘密：第二號玩家是善良的。';
  ok(st(room, 'tellInfo', { seatId: seat.id, text }));
  assert.equal(viewFor(room, { pid: seat.pid }).prompt, null);
  assertPrivateInfo(room, seat, text);

  const mine = viewFor(room, { pid: seat.pid });
  mine.chat.push({ seq: room.chatSeq + 1, from: 'st', to: seat.id, info: true, k: 'act', text: '你選擇了目標' });
  assert(!chatMessages(mine, 'st').some(m => m.k === 'act'), '自己的選人操作不當成說書人反饋');
}

console.log('storyteller feedback appears once in private chat, stays in HUD and respects privacy');
