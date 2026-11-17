// 調試模式（測試服）：機器人、說書人換成座位身份、離席時機器人代為主持；沒開 BOTC_DEBUG 的服務器上一律沒有。
// 用法：node tests/debug.test.js
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import net from 'net';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'botc-debug-'));
process.env.DATA_DIR = DATA;
process.env.BOTC_DEBUG = '1';
const store = await import('../lib/store.js');
const { applyStOp, applyPlayerAction } = await import('../lib/ops.js');
const { botStep, setPresence, isBot, renameBots, debugInfo } = await import('../lib/debug.js');
const { autoPicks } = await import('../lib/engine.js');
const { nominate } = await import('../lib/day.js');

const ok = r => assert.strictEqual(r, undefined, r);
const st = (r, op, args = {}) => applyStOp(r, { op, ...args });
const debugRoom = n => { const r = store.createRoom(); r.debug = true; r.settings.pretend = false; if (n) ok(st(r, 'addBots', { n })); return r; };
const autoBots = r => r.seats.forEach(s => ok(st(r, 'dbgBotAuto', { seatId: s.id, on: true })));
// 開局後按座位換成指定角色，從第一個白天開始（和 helpers.js setup 一樣跳過首夜）
function started(roles) {
  const r = debugRoom(roles.length);
  ok(st(r, 'dbgAuto', { on: true }));
  autoBots(r);
  ok(st(r, 'next'));
  r.seats.forEach((s, i) => Object.assign(s, { role: roles[i], fakeRole: null }));
  Object.assign(r.g, { redHerring: null, queue: [], step: null });
  r.phase = 'dawn';
  ok(st(r, 'next'));
  return r;
}

// 機器人：只有開了調試的房間能加，按座位號起名，準備階段才能加減，不超過劇本人數
{
  const plain = store.createRoom();
  assert.match(st(plain, 'addBots', { n: 3 }), /調試/);
  const r = debugRoom(5);
  assert.deepStrictEqual(r.seats.map(s => s.name), ['機器人1', '機器人2', '機器人3', '機器人4', '機器人5']);
  assert.ok(r.seats.every(isBot));
  ok(st(r, 'swapSeats', { a: r.seats[0].id, b: r.seats[4].id }));
  renameBots(r);
  assert.strictEqual(r.seats[0].name, '機器人1');
  ok(applyPlayerAction(r, r.seats[1].pid, { act: 'rename', name: '一個很長的名字' }));
  ok(st(r, 'swapSeats', { a: r.seats[1].id, b: r.seats[2].id }));
  renameBots(r);
  assert.deepStrictEqual([r.seats[1].name, r.seats[2].name], ['機器人2', '一個很長的名字'], '改過名的機器人不再自動改名');
  ok(st(r, 'addBots', { n: 20 }));
  assert.strictEqual(r.seats.length, 15, '最多坐滿劇本人數');
  assert.match(st(r, 'addBots', { n: 1 }), /最多/);
  ok(st(r, 'removeBots'));
  assert.strictEqual(r.seats.length, 0);
  ok(st(r, 'addBots', { n: 7 }));
  ok(st(r, 'next'));
  assert.match(st(r, 'addBots', { n: 1 }), /準備階段/);
  assert.match(st(r, 'removeBots'), /遊戲中/);
  ok(st(r, 'dbgAuto', { on: false }));
  assert.strictEqual(debugInfo(r, null).auto, false);
}

// 說書人留在說書人視角：機器人自己選人，說書人要點的（確認信息、叫下一個）一概不替他做
{
  const r = started(['imp', 'poisoner', 'fortuneteller', 'empath', 'monk', 'chef', 'soldier']);
  setPresence(r, [], true);
  ok(st(r, 'next')); // 第一個白天結束，入夜
  for (let k = 0; k < 20 && botStep(r);) k++;
  const step = r.g.step;
  assert.ok(step && ['ack', 'confirm', 'decide', 'review'].includes(step.status), '停在等說書人的那一步：' + step?.status);
  assert.strictEqual(botStep(r), false);
}

// 說書人換成小惡魔的身份（每晚都醒）：機器人不碰這個座位，其餘座位和說書人的活都由機器人做，一直打到分出勝負
{
  const r = started(['imp', 'poisoner', 'fortuneteller', 'empath', 'monk', 'chef', 'soldier']);
  const me = r.seats[0];
  setPresence(r, [me.id], false);
  let mine = 0, guard = 0;
  while (r.phase !== 'ended' && guard++ < 3000) {
    const step = r.g.step;
    if (r.phase === 'night' && step?.status === 'choose' && step.seatId === me.id) {
      const { ids } = autoPicks(r, step);
      ok(applyPlayerAction(r, me.pid, { act: 'pick', ids }));
      mine++;
      continue;
    }
    if (botStep(r)) continue;
    if (r.phase === 'day') { ok(st(r, 'next')); continue; } // 結束白天還是說書人自己回來點
    assert.fail(`卡住了：${r.phase} ${JSON.stringify(step)}`);
  }
  assert.strictEqual(r.phase, 'ended', '打完一局');
  assert.ok(mine > 0, '小惡魔的選擇是自己做的');
  assert.ok(r.chat.some(m => m.info && m.to !== me.id), '代班說書人給機器人發了信息');
}

// 線下局：玩家自己不選人，說書人換成哪個座位，代班說書人都替所有人點，照樣打得完
{
  const r = debugRoom();
  ok(st(r, 'venue', { venue: 'offline', devices: 'many' }));
  ok(st(r, 'addBots', { n: 7 }));
  ok(st(r, 'dbgAuto', { on: true }));
  ok(st(r, 'next'));
  ['imp', 'poisoner', 'fortuneteller', 'empath', 'monk', 'chef', 'soldier'].forEach((id, i) => Object.assign(r.seats[i], { role: id, fakeRole: null }));
  Object.assign(r.g, { redHerring: null, queue: [], step: null });
  r.phase = 'dawn';
  ok(st(r, 'next'));
  setPresence(r, [r.seats[2].id], false);
  let guard = 0;
  while (r.phase !== 'ended' && guard++ < 3000) {
    if (botStep(r)) continue;
    if (r.phase === 'day') { ok(st(r, 'next')); continue; }
    assert.fail(`線下卡住了：${r.phase} ${JSON.stringify(r.g.step)}`);
  }
  assert.strictEqual(r.phase, 'ended');
}

// 白天：機器人隨機舉手，代班說書人喊立即計票，輪到機器人就定下來，計完自動結算
{
  const r = started(['imp', 'poisoner', 'fortuneteller', 'empath', 'monk', 'chef', 'soldier']);
  const me = r.seats[3];
  setPresence(r, [me.id], false);
  ok(nominate(r, me, r.seats[0]));
  assert.ok(botStep(r));
  assert.ok(r.seats.filter(s => s !== me).every(s => r.nomination.votes[s.id] !== undefined), '機器人都表了態');
  assert.strictEqual(r.nomination.votes[me.id], undefined, '說書人代入的座位等他自己投');
  assert.ok(botStep(r));
  const c = r.nomination.clock;
  assert.ok(c, '代班說書人喊了立即計票');
  for (let k = 0; k < 40 && r.nomination; k++) {
    c.at = Date.now() - 1;
    if (r.seats.find(s => s.id === c.order[c.k]) === me) ok(applyPlayerAction(r, me.pid, { act: 'vote', v: 'abstain' }));
    else botStep(r);
  }
  assert.strictEqual(r.nomination, null, '計完結算了');
  assert.strictEqual(r.history.length, 1);
}

// 換身份菜單要的狀態：每個座位的私密信息序號、線下舉手（舉著 / 還能舉）、說書人那邊等著處理的
{
  const r = debugRoom();
  ok(st(r, 'venue', { venue: 'offline', devices: 'many' }));
  ok(st(r, 'addBots', { n: 7 }));
  ok(st(r, 'next'));
  const d0 = debugInfo(r, null);
  assert.ok(d0.seats.every(s => s.info.length >= 1), '開局發的角色算一條');
  assert.strictEqual(d0.stNight, true, '線下局夜裏都等說書人點');
  Object.assign(r.g, { queue: [], step: null });
  r.phase = 'dawn';
  ok(st(r, 'next'));
  const [a, b] = r.seats;
  Object.assign(b, { role: 'soldier', fakeRole: null }); // 單測舉手，避免抽中貞潔者時多出反噬裁定
  ok(nominate(r, a, b));
  assert.ok(r.nomination.hand, '線下多設備是當面舉手');
  r.nomination.votes[a.id] = 'yes';
  const d = debugInfo(r, a.id);
  assert.strictEqual(d.seats[0].hand, 'up');
  assert.strictEqual(d.seats[1].hand, 'can');
  assert.strictEqual(d.st, 0);
  assert.strictEqual(d.stNight, false);
}

// ———— 起真服務器：先不開 BOTC_DEBUG，再開 ————
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
function start(port, debug) {
  const env = { ...process.env, PORT: port, DATA_DIR: DATA, BOTC_DEBUG: debug ? '1' : '' };
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env });
  return new Promise((res, rej) => {
    child.stdout.on('data', d => { if (String(d).includes('已啓動')) res(child); });
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => rej(new Error('服務器退出 ' + code)));
  });
}
const socks = [];
const call = (s, ev, data = {}) => new Promise(r => s.emit(ev, data, r));
const until = (s, pred, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => { s.off('state', f); rej(new Error('等狀態超時')); }, ms);
  const f = v => { if (pred(v)) { clearTimeout(t); s.off('state', f); res(v); } };
  s.on('state', f);
});
// 向系統要一個空閒端口（隨機挑的會撞上本機開著的調試服務）
const port = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function manualTurns(URL) {
  const opts = { forceNew: true, transports: ['websocket'] };
  const s = io(URL, opts), pl = io(URL, opts);
  socks.push(s, pl);
  const accept = async (socket, event, data) => {
    const result = await call(socket, event, data);
    assert.ok(result.ok, result.error);
    return result;
  };
  const update = async (event, data, pred, socket = s) => {
    const [v] = await Promise.all([until(s, pred), accept(socket, event, data)]);
    return v;
  };
  const op = (op, args = {}) => accept(s, 'st:op', { op, ...args });
  const step = (op, args, pred) => update('st:op', { op, ...args }, pred);
  const player = (act, args, pred, socket = s) => update('pl:act', { act, ...args }, pred, socket);
  const chooses = id => v => v.myId === id && !!v.prompt;
  const atStep = (role, status) => v => v.isSt && v.st.step?.roleId === role && v.st.step.status === status;
  let latest;
  s.on('state', v => { latest = v; });

  const R = await accept(s, 'st:create', { debug: true });
  await op('venue', { venue: 'online' });
  await op('script', { scriptId: 'bmr' });
  await op('addBots', { n: 4 });
  const v = await update('pl:join', { code: R.code, inst: R.inst, pid: 'manual-turns-player', name: '真人' }, x => x.seats.length === 5, pl);
  const [sailor, innkeeper, advocate, zombuul, teaLady] = v.seats.map(x => x.id);
  const roles = ['sailor', 'innkeeper', 'devilsadvocate', 'zombuul', 'tealady'];
  for (let i = 0; i < roles.length; i++) await op('setRole', { seatId: v.seats[i].id, roleId: roles[i] });
  assert.ok(!(await call(s, 'st:op', { op: 'dbgBotAuto', seatId: teaLady, on: false })).ok, '不能改真人的自動操作');
  assert.strictEqual(v.debug.auto, false, '新房間默認由說書人親自主持');
  assert.ok(v.debug.seats.filter(x => x.bot).every(x => x.auto === false), '新機器人默認手動操作');
  await op('dbgBotAuto', { seatId: advocate, on: true });
  const prefs = await step('dbgBotAuto', { seatId: zombuul, on: true }, x => x.debug.seats.find(y => y.id === zombuul)?.auto === true);
  assert.deepStrictEqual(prefs.debug.seats.filter(x => x.bot).map(x => x.auto), [false, false, true, true]);

  // 手動換去別的座位仍可操作；局面未推進時，不搶回身份也不讓水手自動選擇。
  await step('next', {}, chooses(sailor));
  await update('dbg:as', { seatId: innkeeper }, x => x.myId === innkeeper);
  await player('chat', { to: 'all', text: '先看看旅店老闆' }, x => x.chat.some(m => m.text === '先看看旅店老闆'));
  await wait(1100);
  assert.strictEqual(latest.myId, innkeeper);
  assert.strictEqual(latest.debug.turn, sailor);
  await update('dbg:as', { seatId: sailor }, chooses(sailor));

  // 玩家選人後交回說書人；開著自動操作的魔鬼代言人會自己選，再停在說書人的確認卡。
  await player('pick', { ids: [teaLady] }, atStep('sailor', 'decide'));
  await step('decide', { choice: teaLady }, atStep('devilsadvocate', 'ack'));
  await step('ack', {}, atStep('dawn', 'review'));
  await step('dawn', {}, x => x.isSt && x.phase === 'day');

  // 立即計票按座位順序交接；手動座位不會被五秒的自動計票跳過。
  await player('nominate', { targetId: teaLady }, x => x.nomination?.nomineeId === teaLady, pl);
  const counting = await step('startCount', {}, x => x.myId === sailor && x.nomination?.clock?.waiting);
  const { at, step: voteTime } = counting.nomination.clock;
  await wait(Math.max(0, at + voteTime - Date.now()) + 150);
  assert.strictEqual(latest.myId, sailor);
  assert.strictEqual(latest.nomination.clock.k, 0);
  assert.strictEqual(latest.nomination.clock.waiting, true);
  await player('vote', { v: 'abstain' }, x => x.myId === innkeeper && x.nomination?.clock?.waiting);
  await player('vote', { v: 'abstain' }, x => x.nomination?.clock?.k === 4);
  await player('vote', { v: 'abstain' }, x => x.isSt && !x.nomination && x.history.length === 1, pl);

  // 第二夜按水手 → 說書人 → 旅店老闆交接，裁定由說書人選，下一位由玩家選。
  const second = await step('next', {}, chooses(sailor));
  assert.strictEqual(second.night, 2);
  await player('pick', { ids: [zombuul] }, atStep('sailor', 'decide'));
  await step('decide', { choice: sailor }, chooses(innkeeper));
  await player('pick', { ids: [advocate, teaLady] }, atStep('innkeeper', 'decide'));
}

async function manualMoonchild(URL, offline) {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  socks.push(s);
  const send = async (event, data, pred) => {
    const state = pred ? until(s, pred) : null;
    const result = await call(s, event, data);
    assert.ok(result.ok, result.error);
    return state || result;
  };
  const op = (op, args = {}, pred) => send('st:op', { op, ...args }, pred);
  let latest;
  s.on('state', v => { latest = v; });

  await send('st:create', { debug: true });
  await op('venue', { venue: offline ? 'offline' : 'online', devices: 'many' });
  await op('script', { scriptId: 'bmr' });
  const v = await op('addBots', { n: 5 }, x => x.seats.length === 5);
  const [moonchild, victim] = v.seats;
  const roles = ['moonchild', 'fool', 'zombuul', 'tealady', 'pacifist'];
  for (let i = 0; i < roles.length; i++) await op('setRole', { seatId: v.seats[i].id, roleId: roles[i] });
  const started = await op('next', {}, x => x.phase === 'night');
  if (started.st.step.status === 'fake') await op('pretend', {}, x => x.st?.step?.status === 'review');
  await op('dawn', {}, x => x.phase === 'day');
  if (offline) await op('dbgAuto', { on: true }); // 就算開了代班說書人，也要等手動月之子自己選。

  const isMoonchildTurn = x => x.myId === moonchild.id && x.prompt?.roleId === 'moonchild';
  await op('setDead', { seatId: moonchild.id, dead: true }, isMoonchildTurn);
  await send('dbg:as', { seatId: victim.id }, x => x.myId === victim.id);
  await wait(1750);
  assert.ok(!latest.words.length, '即使暫時切換身份，也不替月之子選人');
  await send('dbg:as', { seatId: moonchild.id }, isMoonchildTurn);
  const selected = await send('pl:act', { act: 'pick', ids: [victim.id] }, x => x.words.some(w => w.from === moonchild.id));
  assert.equal(selected.words.find(w => w.from === moonchild.id).to, victim.id);
  if (!offline) assert.ok(selected.isSt, '線上月之子選完後交回說書人');
  s.close();
}

let server;
try {
  // 正式服：大廳沒有調試模式，建房帶上 debug 也不算，沒有機器人、不能換身份
  {
    const P = await port(), URL = `http://127.0.0.1:${P}`;
    server = await start(P, false);
    const s = io(URL, { forceNew: true, transports: ['websocket'] });
    socks.push(s);
    let told = false;
    s.on('debug', () => { told = true; });
    const R = await call(s, 'st:create', { debug: true });
    const v = await until(s, x => x.code === R.code);
    await wait(150);
    assert.ok(!told, '正式服不亮調試模式');
    assert.strictEqual(v.debug, undefined);
    assert.match((await call(s, 'st:op', { op: 'addBots', n: 3 })).error, /調試/);
    assert.match((await call(s, 'st:op', { op: 'dbgBotAuto', seatId: 'nope', on: false })).error, /調試/);
    assert.strictEqual((await call(s, 'dbg:as', { seatId: null })).error, '無權限');
    s.close();
    server.kill();
    await wait(200);
  }
  // 測試服
  {
    const P = await port(), URL = `http://127.0.0.1:${P}`;
    server = await start(P, true);
    const s = io(URL, { forceNew: true, transports: ['websocket'], autoConnect: false });
    socks.push(s);
    const told = new Promise(r => s.once('debug', r));
    s.connect();
    await told;
    const R = await call(s, 'st:create', { debug: true });
    assert.ok(R.ok);
    let v = await until(s, x => x.code === R.code && x.debug);
    assert.strictEqual(v.debug.as, null);
    assert.ok((await call(s, 'st:op', { op: 'addBots', n: 5 })).ok);
    v = await until(s, x => x.seats.length === 5);
    assert.ok(v.seats.every(x => x.online), '機器人一直在場');
    const third = v.seats[2];
    // 換成 3 號：看到的就是 3 號玩家的狀態，操作也算 3 號的
    assert.ok((await call(s, 'dbg:as', { seatId: third.id })).ok);
    v = await until(s, x => x.myId === third.id);
    assert.strictEqual(v.isSt, false);
    assert.strictEqual(v.debug.as, third.id);
    assert.strictEqual(v.debug.seats.length, 5);
    assert.ok((await call(s, 'pl:act', { act: 'chat', to: 'all', text: '我是三號' })).ok);
    v = await until(s, x => x.chat.some(m => m.text === '我是三號'));
    assert.strictEqual(v.chat.find(m => m.text === '我是三號').from, third.id);
    // 刷新：帶著原來的座位回來
    const s2 = io(URL, { forceNew: true, transports: ['websocket'] });
    socks.push(s2);
    assert.ok((await call(s2, 'st:join', { code: R.code, stKey: R.stKey, debug: true, as: third.id })).ok);
    v = await until(s2, x => x.code === R.code);
    assert.strictEqual(v.myId, third.id);
    // 不存在的座位：換回說書人
    assert.ok((await call(s2, 'dbg:as', { seatId: 'nope' })).ok);
    v = await until(s2, x => x.isSt);
    assert.strictEqual(v.debug.as, null);
    // 大廳沒勾調試模式回到房間：調試關掉，說書人只能看自己的視角
    assert.ok((await call(s2, 'st:join', { code: R.code, stKey: R.stKey, debug: false, as: third.id })).ok);
    v = await until(s2, x => x.code === R.code);
    assert.ok(v.isSt && !v.debug);
    assert.strictEqual((await call(s2, 'dbg:as', { seatId: third.id })).error, '無權限');
    await manualTurns(URL);
    await manualMoonchild(URL, false);
    await manualMoonchild(URL, true);
    console.log('debug tests ok');
  }
} finally {
  socks.forEach(s => s.close());
  server?.kill();
  await wait(200);
  fs.rmSync(DATA, { recursive: true, force: true });
}
