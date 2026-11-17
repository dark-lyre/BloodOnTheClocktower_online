// 線下多設備：夜裏私密信息發到了手機上，說書人這邊也停一張卡叫他把人叫醒看手機（閉著眼的人不會自己去看）。
// 首夜爪牙 / 瘋子 / 惡魔分開叫醒；別人能力帶來的私下通知（傳位、麻臉巫婆、舞蛇人換到惡魔）停成 ack。用法：node tests/wakephone.test.js
import assert from 'assert';
import { createRoom } from '../lib/store.js';
import { applyPlayerAction, applyStOp, joinPlayer, undoOf } from '../lib/ops.js';
import { autoPicks } from '../lib/engine.js';
import { ROLES } from '../public/js/roles.js';
import { isBuiltin } from '../lib/script.js';
import { viewFor } from '../lib/view.js';

const st = (r, op, a = {}) => { const x = applyStOp(r, { op, ...a }); assert.strictEqual(typeof x === 'string' ? x : undefined, undefined, op); return x; };
function mk(dev, roles, venue = 'offline', lunaticRole) {
  const r = createRoom();
  r.settings.pretend = false;
  if (venue === 'offline') st(r, 'venue', { venue, devices: dev });
  const all = Object.keys(ROLES).filter(k => isBuiltin(k) && ['townsfolk', 'outsider', 'minion', 'demon'].includes(ROLES[k].team));
  st(r, 'upload', { entries: [{ id: '_meta', name: 'all' }, ...all] });
  if (venue === 'offline' && dev === 'one') st(r, 'addSeats', { names: roles.map((_, i) => 'n' + i) });
  else roles.forEach((_, i) => joinPlayer(r, 'p' + i, 'n' + i));
  roles.forEach((x, i) => st(r, 'setRole', { seatId: r.seats[i].id, roleId: x, fakeRole: x === 'lunatic' ? lunaticRole : undefined }));
  st(r, 'next', { force: true });
  return r;
}
// 走夜晚：policy[roleId](step) 給要點的 { ids, role }；stop(step) 為真時停下
function drive(r, policy = {}, stop = () => false) {
  for (let k = 0; k < 80 && r.phase === 'night'; k++) {
    const s = r.g.step;
    if (stop(s)) return s;
    const p = s.status === 'choose' ? policy[s.roleId]?.(s, r) : undefined;
    if (s.status === 'review') st(r, 'dawn');
    else if (s.status === 'choose') st(r, 'pick', p || autoPicks(r, s));
    else if (s.status === 'confirm') st(r, 'confirm', { fields: s.form.truth });
    else if (s.status === 'decide') st(r, 'decide', { choice: s.decide.options.at(-1).id });
    else st(r, 'ack');
  }
}
function passDay(r) {
  if (r.phase === 'dawn') st(r, 'next');
  for (const w of [...(r.g.lastWords || [])]) st(r, 'word', { seatId: w.seatId, targetId: null });
  if (r.phase === 'day') st(r, 'next');
}
const id = (r, i) => r.seats[i].id;
const sent = (r, to, src) => r.chat.some(m => m.to === to && m.info && m.src === src);
const player = (r, seat) => viewFor(r, { pid: seat.pid });
const roleNotices = (r, seat) => player(r, seat).chat.filter(m => m.k === 'role').map(m => m.src);
function assertRolesPending(r) {
  for (const seat of r.seats) {
    const view = player(r, seat);
    assert.strictEqual(view.myRole, null, '等說書人確認後才同時發給所有玩家');
    assert.deepStrictEqual(roleNotices(r, seat), []);
    assert(!view.fx.some(e => e.k === 'role'));
  }
}

// 首夜：爪牙、惡魔各停一張；信息到這一步才發，撤銷退回上一張
{
  const r = mk('many', ['imp', 'poisoner', 'chef', 'empath', 'slayer', 'virgin', 'saint']);
  const [imp, poi] = r.seats;
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.status], ['minioninfo', 'ack'], '叫醒爪牙');
  assert.deepStrictEqual(r.g.step.lines.map(l => [l.seatId, l.demon]), [[poi.id, imp.id]], '卡上寫爪牙會看到誰是惡魔');
  assert(sent(r, poi.id, 'minioninfo'), '爪牙信息已經在他手機上');
  assert(!sent(r, imp.id, 'demoninfo'), '惡魔信息還沒發：輪到他才亮');
  assert(!r.g.order.includes('minioninfo'), '不佔進度條的格子');
  st(r, 'ack');
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.status], ['demoninfo', 'ack'], '叫醒惡魔');
  assert.deepStrictEqual(r.g.step.lines[0].bluffs?.length, 3, '卡上有偽裝');
  assert(sent(r, imp.id, 'demoninfo'));
  assert.strictEqual(undoOf(r), 'ack');
  st(r, 'undo');
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.status], ['minioninfo', 'ack'], '撤銷退回爪牙那張');
  st(r, 'ack'); st(r, 'ack');
  assert.strictEqual(r.g.step.roleId, 'poisoner');
  assert(!r.g.log.some(e => /已告知/.test(e.text || '')), '多設備日誌只記「已發送」，不重複記「已告知」');
  console.log('多設備首夜：爪牙、惡魔各自叫醒看手機 ✔');
}

// 有瘋子：先停下確認假信息，再發到他的手機。惡魔只收到自己的爪牙、偽裝和誰是瘋子。
{
  const r = mk('many', ['zombuul', 'godfather', 'devilsadvocate', 'lunatic', 'sailor', 'chambermaid', 'innkeeper', 'gambler', 'gossip', 'exorcist'], 'offline', 'pukka');
  const [demon, godfather, advocate, luna, sailor] = r.seats;
  assert.strictEqual(r.g.step.roleId, 'lunainfo');
  assertRolesPending(r);
  const { id: stepId, lunaticDraft } = r.g.step;
  assert.strictEqual(lunaticDraft.seatId, luna.id);
  assert.strictEqual(lunaticDraft.fakeRole, 'pukka');
  assert(lunaticDraft.demons.includes('shabaloth') && lunaticDraft.demons.includes('zombuul'));
  assert(!sent(r, luna.id, 'demoninfo') && !sent(r, demon.id, 'demoninfo'));
  assert(!sent(r, godfather.id, 'minioninfo'));
  assert.strictEqual(player(r, luna).bluffs, null);
  assert.strictEqual(player(r, luna).st, null);

  const bluffs = ['sailor', 'gossip', 'goon'];
  const picks = { op: 'lunaticInfo', stepId, fakeRole: 'shabaloth', minions: [sailor.id, demon.id], bluffs };
  for (const patch of [{ stepId: 'old' }, { minions: [luna.id, demon.id] }, { minions: [demon.id, demon.id] },
    { minions: [demon.id] }, { bluffs: ['sailor', 'sailor', 'gossip'] }, { bluffs: ['sailor', 'gossip', 'zombuul'] },
    { fakeRole: 'lunatic' }, { fakeRole: 'sailor' }, { fakeRole: 'missing-role' }]) {
    assert.strictEqual(typeof applyStOp(r, { ...picks, ...patch }), 'string');
    assert(!sent(r, luna.id, 'demoninfo'));
    assert.strictEqual(luna.fakeRole, 'pukka', '無效的草稿不應改動座位');
    assert.deepStrictEqual(roleNotices(r, luna), []);
  }
  st(r, 'lunaticInfo', picks);
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.status], ['minioninfo', 'ack']);
  assert(sent(r, godfather.id, 'minioninfo') && !sent(r, luna.id, 'demoninfo') && !sent(r, demon.id, 'demoninfo'));
  assert.strictEqual(player(r, luna).bluffs, null, '爪牙醒來時，瘋子還沒拿到假偽裝');
  assert.strictEqual(player(r, demon).bluffs, null, '爪牙醒來時，惡魔還沒拿到偽裝');
  for (const seat of r.seats) {
    const shown = seat === luna ? 'shabaloth' : seat.role;
    assert.strictEqual(player(r, seat).myRole, shown);
    assert.deepStrictEqual(roleNotices(r, seat), [shown]);
  }
  st(r, 'ack');
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.status], ['lunainfo', 'ack']);
  const [line] = r.g.step.lines;
  assert.deepStrictEqual([line.seatId, line.fakeRole, line.minions, line.bluffs], [luna.id, 'shabaloth', [demon.id, sailor.id], bluffs]);
  const received = () => player(r, luna).chat.filter(m => m.src === 'demoninfo');
  assert.deepStrictEqual(received()[0].f, line.f);
  assert.deepStrictEqual(player(r, luna).bluffs, bluffs);
  assert.strictEqual(player(r, luna).myRole, 'shabaloth');
  assert.deepStrictEqual(roleNotices(r, luna), ['shabaloth']);
  assert.strictEqual(typeof applyStOp(r, picks), 'string', '重送同一操作不會多發一條');
  st(r, 'undo');
  st(r, 'undo');
  assert.strictEqual(r.g.step.lunaticDraft.seatId, luna.id);
  assert.strictEqual(player(r, luna).myRole, 'shabaloth', '撤銷不會讓已發身份消失');
  st(r, 'ack');
  assert.strictEqual(r.g.step.roleId, 'minioninfo');
  st(r, 'ack');
  assert.strictEqual(received().length, 1, '撤銷再確認也不會發第二份假信息');
  assert.deepStrictEqual(r.g.step.lines[0].bluffs, bluffs);
  assert.strictEqual(r.g.step.lines[0].fakeRole, 'shabaloth');
  assert.deepStrictEqual(roleNotices(r, luna), ['shabaloth']);
  st(r, 'ack');
  assert.deepStrictEqual([r.g.step.roleId, r.g.step.lines[0].minions], ['demoninfo', [godfather.id, advocate.id]]);
  assert.strictEqual(player(r, demon).myRole, 'zombuul');
  assert.strictEqual(player(r, demon).bluffs.length, 3);
  const stLog = viewFor(r, { st: true }).st.log;
  assert(stLog.some(l => l.e?.k === 'setup' && l.e.grim.some(([seat, role, info]) => seat === luna.id && role === 'lunatic' && info.fake === 'shabaloth')),
    '确认后的假恶魔记入开局角色分配');
  assert.deepStrictEqual(stLog.find(l => l.e?.k === 'told' && l.e.fake && l.e.seat === luna.id).e.f, line.f);
  assert.strictEqual(drive(r, {}, s => s.seatId === luna.id), undefined, '改成沙巴洛斯後，首夜不再排原本普卡的行動');
  passDay(r);
  const action = drive(r, {}, s => s.seatId === luna.id && s.status === 'choose');
  assert.deepStrictEqual([action?.roleId, action?.choose.count], ['shabaloth', 2]);
  console.log('多設備有瘋子：確認後才發送，撤銷不重發 ✔');
}

// 線上：照舊不停
{
  const r = mk(null, ['imp', 'poisoner', 'chef', 'empath', 'slayer', 'virgin', 'saint'], 'online');
  assert.notStrictEqual(r.g.step.roleId, 'minioninfo', '線上不停爪牙信息');
  assert(r.chat.some(m => m.src === 'demoninfo'));
  console.log('線上首夜不停 ✔');
}

{
  const roles = ['zombuul', 'godfather', 'lunatic', 'sailor', 'chambermaid', 'innkeeper', 'gambler'];
  const r = mk(null, roles, 'online', 'zombuul');
  const [demon, , luna, sailor] = r.seats;
  assert.strictEqual(r.g.step.roleId, 'lunainfo');
  assert(!sent(r, luna.id, 'demoninfo') && !sent(r, demon.id, 'demoninfo'));
  assertRolesPending(r);
  st(r, 'lunaticInfo', { stepId: r.g.step.id, fakeRole: 'pukka', minions: [sailor.id], bluffs: ['sailor', 'gossip', 'goon'] });
  assert(sent(r, luna.id, 'demoninfo') && sent(r, demon.id, 'demoninfo'));
  assert.strictEqual(player(r, luna).myRole, 'pukka');
  assert.deepStrictEqual(roleNotices(r, luna), ['pukka']);
  const action = drive(r, {}, s => s.seatId === luna.id && s.status === 'choose');
  assert.deepStrictEqual([action?.roleId, player(r, luna).prompt?.count], ['pukka', 1], '改成普卡後在首夜就能選一人');
  assert.strictEqual(applyPlayerAction(r, luna.pid, { act: 'pick', ids: [sailor.id] }), undefined);
  assert.deepStrictEqual(r.g.luna, { seatId: luna.id, ids: [sailor.id] });
  assert(r.chat.some(m => m.to === demon.id && m.src === 'lunatic' && m.f.some(t => t.s === sailor.id)));
  assert(!r.g.pukka, '瘋子的選擇不會真的下毒');

  const small = mk(null, roles.slice(0, 6), 'online', 'zombuul');
  const [smallDemon, smallMinion, smallLuna] = small.seats;
  const { id: stepId, lunaticDraft } = small.g.step;
  assert.deepStrictEqual([lunaticDraft.minions, lunaticDraft.bluffs], [[], []]);
  assertRolesPending(small);
  st(small, 'lunaticInfo', { stepId, fakeRole: 'pukka', minions: [], bluffs: [] });
  assert.strictEqual(player(small, smallLuna).myRole, 'pukka');
  assert.deepStrictEqual(roleNotices(small, smallLuna), ['pukka']);
  assert(!sent(small, smallLuna.id, 'demoninfo') && !sent(small, smallDemon.id, 'demoninfo') && !sent(small, smallMinion.id, 'minioninfo'));
  console.log('線上瘋子要先確認，五六人局不互認 ✔');
}

// 三種模式都先確認假惡魔，再發身份；五六人局只確認身份、不發互認和偽裝。
for (const [venue, devices] of [['online', 'many'], ['offline', 'many'], ['offline', 'one']]) {
  for (const count of [5, 6, 7]) {
    for (const [initial, chosen] of [['zombuul', 'pukka'], ['pukka', 'shabaloth']]) {
      const roles = ['zombuul', 'godfather', 'lunatic', 'sailor', 'chambermaid', 'innkeeper', 'gambler'].slice(0, count);
      const r = mk(devices, roles, venue, initial);
      const luna = r.seats[2], before = viewFor(r, { st: true }).st.step;
      assert.strictEqual(before.prepareLunatic, true);
      assert(before.lunaticDraft.demons.includes(chosen));
      assertRolesPending(r);
      const { minions, bluffs } = before.lunaticDraft;
      st(r, 'lunaticInfo', { stepId: before.id, fakeRole: chosen, minions, bluffs });
      assert.strictEqual(player(r, luna).myRole, chosen);
      assert.deepStrictEqual(roleNotices(r, luna), [chosen], '只发送确认后的身份');
      assert.strictEqual(r.seats[2].fakeRole, chosen);
      if (count < 7) {
        assert.deepStrictEqual([minions, bluffs], [[], []]);
        assert(!r.chat.some(m => ['minioninfo', 'demoninfo'].includes(m.src)), '五六人局不发送互认');
      }
      const action = drive(r, {}, step => step.seatId === luna.id && step.status === 'choose');
      assert.strictEqual(!!action, chosen === 'pukka', '首夜行动随确认后的假恶魔变化');
      if (action) assert.strictEqual(action.roleId, chosen);
      if (count >= 7) assert.strictEqual(player(r, luna).chat.filter(m => m.src === 'demoninfo').length, 1);
    }
  }
}
console.log('瘋子假惡魔：三種模式、五至七人及首夜行動一致 ✔');

// 已发出的身份不能靠撤销再改；互认尚未发出时仍可调整假爪牙和假伪装。
{
  const r = mk('many', ['zombuul', 'godfather', 'lunatic', 'sailor', 'chambermaid', 'innkeeper', 'gambler'], 'offline', 'zombuul');
  const luna = r.seats[2], draft = r.g.step;
  st(r, 'lunaticInfo', { stepId: draft.id, fakeRole: 'pukka', minions: [r.seats[3].id], bluffs: ['sailor', 'gossip', 'goon'] });
  assert(!sent(r, luna.id, 'demoninfo'));
  st(r, 'undo');
  const back = viewFor(r, { st: true }).st.step;
  assert.strictEqual(player(r, luna).myRole, 'pukka', '撤销不收回玩家已经看到的身份');
  assert.deepStrictEqual(back.lunaticDraft.demons, ['pukka']);
  assert.strictEqual(typeof applyStOp(r, { op: 'lunaticInfo', stepId: back.id, fakeRole: 'shabaloth', minions: [r.seats[4].id], bluffs: ['fool', 'gambler', 'goon'] }), 'string');
  st(r, 'lunaticInfo', { stepId: back.id, fakeRole: 'pukka', minions: [r.seats[4].id], bluffs: ['fool', 'gambler', 'goon'] });
  st(r, 'ack');
  assert.deepStrictEqual(r.g.step.lines[0].minions, [r.seats[4].id]);
  assert.deepStrictEqual(r.g.step.lines[0].bluffs, ['fool', 'gambler', 'goon']);
  assert.deepStrictEqual(roleNotices(r, luna), ['pukka'], '重新确认不重复发身份');
  assert.strictEqual(player(r, luna).chat.filter(m => m.src === 'demoninfo').length, 1);
  console.log('撤銷後鎖定已發身份、未發假信息仍可編輯 ✔');
}

// 小惡魔自殺傳位：爪牙手機上收到新角色，說書人停一張叫醒他
{
  const r = mk('many', ['imp', 'poisoner', 'chef', 'empath', 'slayer', 'virgin', 'saint']);
  const fixed = { imp: () => ({ ids: [id(r, 6)] }), poisoner: () => ({ ids: [id(r, 4)] }) };
  drive(r, fixed); passDay(r);
  drive(r, { ...fixed, imp: () => ({ ids: [id(r, 0)] }) }, s => s.roleId === 'imp' && s.status === 'ack');
  const s = r.g.step;
  assert.deepStrictEqual([s.roleId, s.status, s.told?.map(t => t.seatId)], ['imp', 'ack', [id(r, 1)]], '停下叫醒新惡魔');
  assert.strictEqual(r.seats[1].role, 'imp');
  st(r, 'ack');
  console.log('多設備小惡魔傳位：叫醒新惡魔看手機 ✔');
}

// 麻臉巫婆換了別人的角色
{
  const r = mk('many', ['pithag', 'imp', 'chef', 'empath', 'monk', 'saint', 'soldier', 'slayer']);
  drive(r); passDay(r);
  const s = drive(r, { pithag: () => ({ ids: [id(r, 2)], role: 'sage' }) }, s => s.roleId === 'pithag' && s.status === 'ack');
  assert.deepStrictEqual(s?.told?.map(t => [t.seatId, t.k]), [[id(r, 2), 'role']], '叫醒被換角色的人');
  console.log('多設備麻臉巫婆：叫醒被換的人看手機 ✔');
}

// 舞蛇人換到惡魔：兩人手機都收到了，原惡魔閉著眼，也要停
{
  const r = mk('many', ['snakecharmer', 'oracle', 'nodashii', 'witch', 'saint', 'empath', 'flowergirl']);
  const s = drive(r, { snakecharmer: () => ({ ids: [id(r, 2)] }) }, s => s.roleId === 'snakecharmer' && s.status === 'ack');
  assert(s?.result?.e?.swap, '換了');
  assert(s.told.some(t => t.seatId === id(r, 2)), '原惡魔在要叫醒的人裏');
  console.log('多設備舞蛇人換到惡魔：停下 ✔');
}
