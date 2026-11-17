// 夢殞春宵規則審查：跨角色變化不應保留失效的毒、丟失哲學家身份，或錯判雙子勝負。
// 用法：node tests/rules-audit-snv.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlayerAction, applyStOp } from '../lib/ops.js';
import { run, willRun } from '../lib/engine.js';
import { checkWin, execute, killSeat, revive } from '../lib/rules.js';
import { startDay } from '../lib/day.js';
import { addEff, alignOf, charOf, dropEff, FOREVER, hasEff, impaired, isGoodSeat, keptAbility } from '../lib/util.js';
import { syncTwins } from '../lib/twins.js';
import { viewFor } from '../lib/view.js';
import { setup, S, ok } from './helpers.js';

function only(room, roleId, night = 2) {
  room.phase = 'night';
  Object.assign(room.g, { night, step: null, beat: null, queue: [{ roleId, seatId: S(room, roleId).id, at: 1 }] });
  run(room);
  assert.equal(room.g.step.roleId, roleId);
}

function pick(room, actor, ids, role) {
  ok(applyPlayerAction(room, actor.pid, { act: 'pick', ids, role }));
}

test('亡骨魔殺死的爪牙被改成非爪牙後，不再使鄰近鎮民中毒', () => {
  // https://wiki.bloodontheclocktower.com/Vigormortis ：Summary 第四條。
  const room = setup(['vigormortis', 'witch', 'dreamer', 'pithag', 'sage', 'clockmaker', 'oracle']);
  room.scriptId = 'snv';
  const witch = S(room, 'witch'), dreamer = S(room, 'dreamer');
  only(room, 'vigormortis');
  pick(room, S(room, 'vigormortis'), [witch.id]);
  assert.equal(room.g.step.decide.kind, 'neighbor');
  ok(applyStOp(room, { op: 'decide', choice: dreamer.id }));
  assert.equal(witch.dead, true);
  assert.equal(witch.keep, true);
  assert.equal(impaired(room, dreamer), true);

  only(room, 'pithag', 3);
  pick(room, S(room, 'pithag'), [witch.id], 'seamstress');
  assert.equal(witch.role, 'seamstress');
  assert.equal(witch.keep, false);
  assert.equal(impaired(room, dreamer), false, '死爪牙已成為鎮民，亡骨魔不能再藉他毒鄰居');
});

test('理髮師把亡骨魔換到另一名玩家後，新亡骨魔不能接續舊死亡爪牙的能力和毒', () => {
  // https://wiki.bloodontheclocktower.com/Vigormortis ：保留能力依附殺死他的亡骨魔。
  // https://wiki.bloodontheclocktower.com/Abilities ：換角色立即失去原能力及其持續效果。
  const room = setup(['vigormortis', 'witch', 'dreamer', 'pithag', 'barber', 'artist', 'oracle']);
  room.scriptId = 'snv';
  const original = S(room, 'vigormortis'), witch = S(room, 'witch'), dreamer = S(room, 'dreamer'), next = S(room, 'artist');
  only(room, 'vigormortis');
  pick(room, original, [witch.id]);
  ok(applyStOp(room, { op: 'decide', choice: dreamer.id }));
  assert.equal(keptAbility(room, witch), true);
  assert.equal(impaired(room, dreamer), true);

  killSeat(room, S(room, 'barber'), '規則審查：理髮師死亡');
  only(room, 'barber', 3);
  pick(room, original, [original.id, next.id]);
  assert.equal(original.role, 'artist');
  assert.equal(next.role, 'vigormortis');
  assert.equal(witch.dead, true);
  assert.equal(keptAbility(room, witch), false, '新持有者未殺死這名爪牙，不能繼承原亡骨魔的保留能力');
  assert.equal(willRun(room, { roleId: 'witch', seatId: witch.id }), false);
  assert.equal(impaired(room, dreamer), false, '原亡骨魔永久離任後，其毒不會由新的亡骨魔接續');
});

test('麻臉巫婆把亡骨魔保留的死亡爪牙改成另一爪牙時，保留新能力及原鄰居中毒', () => {
  // Vigormortis Summary 僅在 dead Minion 變 non-Minion 時移除其能力與毒。
  // https://wiki.bloodontheclocktower.com/Vigormortis
  const room = setup(['vigormortis', 'witch', 'dreamer', 'pithag', 'sage', 'clockmaker', 'oracle']);
  room.scriptId = 'snv';
  const witch = S(room, 'witch'), dreamer = S(room, 'dreamer'), target = S(room, 'oracle');
  only(room, 'vigormortis');
  pick(room, S(room, 'vigormortis'), [witch.id]);
  ok(applyStOp(room, { op: 'decide', choice: dreamer.id }));
  assert.equal(keptAbility(room, witch), true);
  assert.equal(impaired(room, dreamer), true);

  only(room, 'pithag', 3);
  pick(room, S(room, 'pithag'), [witch.id], 'cerenovus');
  assert.equal(witch.role, 'cerenovus');
  assert.equal(witch.dead, true);
  assert.equal(keptAbility(room, witch), true, '仍是死亡爪牙，原亡骨魔繼續讓他擁有現在角色的能力');
  assert.equal(impaired(room, dreamer), true, '仍是爪牙，原本選定的鄰近鎮民繼續中毒');

  only(room, 'cerenovus', 4);
  pick(room, witch, [target.id], 'clockmaker');
  assert.equal(hasEff(room, target, 'mad'), true, '死亡的新洗腦師仍能正常發動能力');
  assert.equal(impaired(room, dreamer), true);
});

test('理髮師交換獲得能力的哲學家時，交換的是哲學家身份', () => {
  // Philosopher: gained ability does not change their character.
  // https://wiki.bloodontheclocktower.com/Philosopher
  // Barber swaps characters: https://wiki.bloodontheclocktower.com/Barber
  const room = setup(['philosopher', 'oracle', 'dreamer', 'fanggu', 'barber', 'pithag', 'sage']);
  room.scriptId = 'snv';
  const philosopher = S(room, 'philosopher'), oracle = S(room, 'oracle'), dreamer = S(room, 'dreamer');
  only(room, 'philosopher');
  pick(room, philosopher, [], 'oracle');
  assert.equal(charOf(philosopher), 'philosopher');
  assert.equal(impaired(room, oracle), true);

  killSeat(room, S(room, 'barber'), '規則審查：理髮師死亡');
  only(room, 'barber', 3);
  pick(room, S(room, 'fanggu'), [philosopher.id, dreamer.id]);
  assert.equal(charOf(philosopher), 'dreamer');
  assert.equal(charOf(dreamer), 'philosopher', '新持有者得到哲學家身份，並非舊哲學家借用的神諭者身份');
  assert.equal(impaired(room, oracle), false, '原哲學家的醉酒隨能力離開而解除');
});

test('善良雙子舞蛇人變成邪惡惡魔後，處決他不能錯判為善良雙子被處決', () => {
  // https://wiki.bloodontheclocktower.com/Evil_Twin ：同陣營雙子須重新配對。
  // https://wiki.bloodontheclocktower.com/Snake_Charmer ：交換角色與陣營。
  const room = setup(['eviltwin', 'snakecharmer', 'fanggu', 'pithag', 'sage', 'artist', 'oracle']);
  room.scriptId = 'snv';
  const twin = S(room, 'eviltwin'), snake = S(room, 'snakecharmer'), demon = S(room, 'fanggu');
  // 說書人在首夜合法選擇舞蛇人為善良雙子；固定配對以排除隨機性。
  room.g.twin = { holder: twin.id, evil: twin.id, good: snake.id };
  only(room, 'snakecharmer');
  pick(room, snake, [demon.id]);
  assert.equal(snake.role, 'fanggu');
  assert.equal(alignOf(snake), 'evil');
  assert.equal(alignOf(demon), 'good');

  startDay(room);
  execute(room, snake);
  assert.notEqual(room.winner, 'evil', '被處決者已是邪惡惡魔；舊善良雙子記錄不能直接讓邪惡獲勝');
});

function twins() {
  const room = setup(['eviltwin', 'snakecharmer', 'fanggu', 'pithag', 'sage', 'artist', 'oracle']);
  room.scriptId = 'snv';
  startDay(room);
  const holder = S(room, 'eviltwin'), other = S(room, 'snakecharmer');
  room.g.twin = { holder: holder.id, evil: holder.id, good: other.id };
  return { room, holder, other };
}

function assertPair(room, holder) {
  const t = room.g.twin;
  assert.equal(t.holder, holder.id);
  assert.ok([t.good, t.evil].includes(holder.id));
  assert.equal(isGoodSeat(room.seats.find(s => s.id === t.good)), true);
  assert.equal(isGoodSeat(room.seats.find(s => s.id === t.evil)), false);
}

test('原雙子陣營未變或只是對手角色改變時，保留配對且不洩露新角色', () => {
  const { room, holder, other } = twins(), pair = { ...room.g.twin };
  assert.equal(syncTwins(room), null);
  other.role = 'oracle';
  const chat = room.chat.length, fx = room.fx.length;
  assert.equal(syncTwins(room), null);
  assert.deepEqual(room.g.twin, pair);
  assertPair(room, holder);
  assert.equal(room.chat.length, chat);
  assert.equal(room.fx.length, fx);
});

test('原善良雙子變邪惡後，選擇相反陣營新雙子並只私下通知新雙方一次', () => {
  const { room, holder, other } = twins();
  other.align = 'evil';
  const chat = room.chat.length, fx = room.fx.length;
  assert.equal(syncTwins(room).reason, 'repaired');
  assertPair(room, holder);
  assert.notEqual(room.g.twin.good, other.id);
  const messages = room.chat.slice(chat), recipients = [holder.id, room.g.twin.good].sort();
  assert.deepEqual(messages.map(m => m.to).sort(), recipients);
  assert.ok(messages.every(m => m.info && m.src === 'eviltwin'));
  assert.deepEqual(room.fx.slice(fx).map(e => e.aud).sort(), recipients);
  assert.equal(syncTwins(room), null);
  assert.equal(room.chat.length, chat + 2);
});

test('邪惡雙子持有者變善良後，自己成為善良雙子並與邪惡玩家配對', () => {
  const { room, holder, other } = twins();
  holder.align = 'good';
  assert.equal(syncTwins(room).reason, 'repaired');
  assertPair(room, holder);
  assert.equal(room.g.twin.good, holder.id);
  assert.notEqual(room.g.twin.evil, other.id);
  execute(room, holder);
  assert.equal(room.winner, 'evil', '處決的是善良持有者，仍應讓邪惡獲勝');
});

test('雙子兩人同時交換陣營時，只修正善惡標記且不重新洩露角色', () => {
  const { room, holder, other } = twins();
  holder.align = 'good'; other.align = 'evil'; other.role = 'pithag';
  const chat = room.chat.length, fx = room.fx.length;
  assert.equal(syncTwins(room).reason, 'alignment');
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: other.id, good: holder.id });
  assert.equal(room.chat.length, chat);
  assert.equal(room.fx.length, fx);
});

for (const kind of ['poison', 'drunk']) {
  test(`雙子${kind === 'poison' ? '中毒' : '醉酒'}時不重配，恢復能力後重新校驗`, () => {
    const { room, holder, other } = twins(), pair = { ...room.g.twin };
    addEff(room, holder.id, kind, 'poisoner', FOREVER);
    other.align = 'evil';
    const chat = room.chat.length;
    assert.equal(syncTwins(room), null);
    assert.deepEqual(room.g.twin, pair);
    assert.equal(room.chat.length, chat);
    dropEff(room, e => e.seat === holder.id && e.kind === kind);
    assert.equal(syncTwins(room).reason, 'repaired');
    assertPair(room, holder);
    assert.notEqual(room.g.twin.good, other.id);
  });
}

test('普通死亡的雙子不再重配，復活後依當前陣營重配', () => {
  const { room, holder, other } = twins(), pair = { ...room.g.twin };
  killSeat(room, holder, '規則審查：普通死亡');
  other.align = 'evil';
  assert.equal(syncTwins(room), null);
  assert.deepEqual(room.g.twin, pair);
  revive(room, holder);
  assert.equal(syncTwins(room).reason, 'repaired');
  assertPair(room, holder);
});

test('亡骨魔保留死亡雙子的能力時可以重配；亡骨魔失效期間暫停', () => {
  const { room, holder, other } = twins();
  const demon = S(room, 'fanggu');
  demon.role = 'vigormortis'; holder.dead = true; holder.keep = true;
  addEff(room, demon.id, 'poison', 'poisoner', FOREVER);
  other.align = 'evil';
  const pair = { ...room.g.twin };
  assert.equal(syncTwins(room), null);
  assert.deepEqual(room.g.twin, pair);
  dropEff(room, e => e.seat === demon.id && e.kind === 'poison');
  assert.equal(syncTwins(room).reason, 'repaired');
  assertPair(room, holder);
});

test('只剩死亡的相反陣營候選時仍能重配，並不阻止善良正常獲勝', () => {
  // 官方 How to Run 明確允許死玩家作為新雙子。
  const { room, holder, other } = twins(), dead = S(room, 'sage');
  for (const seat of room.seats) seat.align = 'evil';
  dead.align = 'good'; dead.dead = true;
  assert.equal(syncTwins(room).reason, 'repaired');
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: holder.id, good: dead.id });
  assert.notEqual(room.g.twin.good, other.id);
  S(room, 'fanggu').dead = true;
  assert.equal(checkWin(room), true);
  assert.equal(room.winner, 'good', '一名雙子已死，不能阻止惡魔死亡帶來的善良勝利');
});

test('完全沒有相反陣營時移除失效對手，合法候選出現後只重配一次', () => {
  const { room, holder, other } = twins();
  for (const seat of room.seats) seat.align = 'evil';
  const chat = room.chat.length;
  assert.equal(syncTwins(room).reason, 'opponent');
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: holder.id, good: null });
  assert.equal(room.chat.length, chat, '沒有新對手就不發送任何玩家身份');
  const log = room.g.log.length;
  assert.equal(syncTwins(room), null);
  assert.equal(room.g.log.length, log);
  other.align = 'good';
  assert.equal(syncTwins(room).reason, 'repaired');
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: holder.id, good: other.id });
  assert.equal(syncTwins(room), null);
});

test('善良持有者沒有任何邪惡對手時，尚未形成的配對不能觸發處決落敗', () => {
  const { room, holder } = twins();
  for (const seat of room.seats) seat.align = 'good';
  assert.equal(syncTwins(room).reason, 'opponent');
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: null, good: holder.id });
  execute(room, holder);
  assert.equal(room.winner, null, '缺少對手時沒有有效雙子配對，不能讓善良因處決持有者而落敗');
});

test('持有者失去雙子角色時撤銷舊配對，不向玩家洩露能力消失', () => {
  const { room, holder, other } = twins();
  holder.role = 'witch';
  const chat = room.chat.length;
  assert.equal(syncTwins(room).reason, 'lost');
  assert.equal(room.g.twin, null);
  assert.equal(room.chat.length, chat);
  execute(room, other);
  assert.equal(room.winner, null);
});

test('新配對認出的哲學家使用真實角色，不暴露其借來的能力', () => {
  const { room, holder, other } = twins(), philosopher = S(room, 'sage');
  for (const seat of room.seats) seat.align = 'evil';
  philosopher.role = 'oracle'; philosopher.was = 'philosopher'; philosopher.align = 'good';
  other.align = 'evil';
  assert.equal(syncTwins(room).reason, 'repaired');
  const message = room.chat.findLast(m => m.to === holder.id && m.src === 'eviltwin');
  assert.deepEqual(message.marks.map(m => m.r), ['philosopher']);
  assert.deepEqual(message.f.filter(t => t.r).map(t => t.r), ['philosopher']);
});

test('夜間重配只把持有者的自身能力喚醒計入侍女', () => {
  const { room, holder, other } = twins();
  room.phase = 'night'; room.g.woke = [];
  other.align = 'evil';
  assert.equal(syncTwins(room).reason, 'repaired');
  assert.deepEqual(room.g.woke, [holder.id]);
  assert.equal(syncTwins(room), null);
  assert.deepEqual(room.g.woke, [holder.id]);
});

test('尚未初次配對的雙子不在同步時提早獲得首夜信息', () => {
  const { room } = twins();
  room.g.twin = null;
  const chat = room.chat.length;
  assert.equal(syncTwins(room), null);
  assert.equal(room.g.twin, null);
  assert.equal(room.chat.length, chat);
});

test('說書人改陣營的操作完成時立即合法重配', () => {
  const { room, holder, other } = twins();
  ok(applyStOp(room, { op: 'setAlign', seatId: other.id, align: 'evil' }));
  assertPair(room, holder);
  assert.notEqual(room.g.twin.good, other.id);
});

for (const devices of ['one', 'many']) {
  test(`線下${devices === 'one' ? '單' : '多'}設備白天改陣營重配，提示只給說書人且信息只給新雙方`, () => {
    const { room, holder, other } = twins();
    Object.assign(room.settings, { venue: 'offline', devices });
    const from = room.chatSeq;
    ok(applyStOp(room, { op: 'setAlign', seatId: other.id, align: 'evil' }));
    assertPair(room, holder);
    const ids = [holder.id, room.g.twin.good], messages = room.chat.filter(m => m.seq > from && m.src === 'eviltwin');
    assert.equal(messages.length, 2);
    assert.equal(room.g.notice.length, 2);
    for (const n of room.g.notice) {
      assert.equal(n.k, 'info');
      assert.equal(n.src, 'eviltwin');
      const m = messages.find(m => m.seq === n.msg);
      assert.ok(m, '提示關聯到一條已發送的私密消息');
      assert.equal(n.seatId, m.to);
      assert.deepEqual(n.f, m.f);
      assert.ok(ids.includes(n.seatId));
    }
    assert.deepEqual(viewFor(room, { st: true }, from).st.notice, room.g.notice[0]);
    for (const seat of room.seats) {
      const v = viewFor(room, { pid: seat.pid }, from);
      assert.equal(v.st, null);
      assert.equal(v.chat.filter(m => m.src === 'eviltwin').length, ids.includes(seat.id) ? 1 : 0);
      assert.ok(v.fx.filter(e => e.src === 'eviltwin').every(e => e.aud === seat.id));
    }
    const watcher = viewFor(room, { pid: 'spectator' }, from);
    assert.equal(watcher.st, null);
    assert.equal(watcher.chat.filter(m => m.src === 'eviltwin').length, 0);
    assert.equal(syncTwins(room), null);
    assert.equal(room.g.notice.length, 2, '重複同步不重複叫醒');
  });
}

test('線下夜初恢復能力後重配，沒有當前能力卡仍保留雙方告知提示', () => {
  const { room, holder, other } = twins();
  Object.assign(room.settings, { venue: 'offline', devices: 'one' });
  room.phase = 'night'; room.g.step = null;
  addEff(room, holder.id, 'drunk', 'minstrel', 2 * room.g.night - 1);
  other.align = 'evil';
  const result = syncTwins(room);
  assert.equal(result.reason, 'repaired');
  assert.deepEqual(room.g.notice, result.tells.map(t => ({ k: 'info', ...t })));
  assert.equal(room.g.notice.length, 2);
  assert.ok(room.g.notice.every(n => room.chat.some(m => m.seq === n.msg && m.to === n.seatId)));
});

test('判勝前修正尚未同步的配對，處決前不能使用舊善良標記', () => {
  const { room, holder, other } = twins();
  holder.align = 'good'; other.align = 'evil';
  assert.equal(checkWin(room), false);
  assert.deepEqual(room.g.twin, { holder: holder.id, evil: other.id, good: holder.id });
  execute(room, other);
  assert.equal(room.winner, null, '邪惡的原善良雙子被處決，不能因舊標記讓邪惡獲勝');
});
