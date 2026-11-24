import { createHmac } from 'node:crypto';
import { isEvil, label, oneDevice, pushChat, seatById } from './util.js';

const EVIL = 'group:evil';
const LUNATIC = 'group:lunatic';
export const isGroupChat = to => to === EVIL || to === LUNATIC;

export function groupChats(room, isSt, seat) {
  if (room.phase === 'lobby' || oneDevice(room) || (!isSt && !seat)) return [];
  // 瘋子的假信息還在準備時，所有玩家都尚未拿到身份，不能從群聊入口提前猜出陣營。
  // 撤銷會退回準備步驟，但已發出的身份收不回；這時仍保留已經開啓的群聊。
  const pending = room.g?.lunaticPending;
  if (pending && !room.chat.some(m => m.from === 'st' && m.to === pending && m.k === 'role' && m.info)) return [];
  const game = room.gameId || room.chatEpoch;
  // 莽夫只得知自己的新陣營，不會因此得知邪惡同伴；另兩種角色不知道自己的真實身份。
  const evil = room.seats.filter(s => isEvil(s) && !['marionette', 'lunatic', 'goon'].includes(s.role));
  // 只按已經告訴瘋子的假爪牙開群。草稿、真實爪牙和之後的陣營變化都不能替換這份名單。
  // 撤銷不會收回私聊；長局清理舊消息後，僅使用已標記正式發送的存檔名單。
  const told = room.chat.find(m => m.from === 'st' && m.info && m.night === 1 && m.src === 'demoninfo'
    && seatById(room, m.to)?.role === 'lunatic');
  const info = told ? { seatId: told.to,
    minions: (Array.isArray(told.marks) ? told.marks : []).filter(m => m.t === 'minion').map(m => m.seatId) }
    : room.g?.lunaticInfo?.sent === true ? room.g.lunaticInfo : null;
  const owner = info && seatById(room, info.seatId);
  const lunatic = owner?.role === 'lunatic' ? owner : null;
  const fakeMinions = (Array.isArray(info?.minions) ? info.minions : []).map(id => seatById(room, id)).filter(Boolean);
  const routes = [];
  const add = (channel, name, seats) => {
    const audience = [...new Set(seats.map(s => s.id))];
    if (!audience.length || (!isSt && !audience.includes(seat.id))) return;
    // 只向這個視角提供可用的頻道代號。瘋子和惡魔都看見同樣的入口，代號不透露實際群組。
    const token = createHmac('sha256', room.stKey).update(JSON.stringify([game, isSt ? 'st' : seat.id, channel])).digest('hex').slice(0, 24);
    routes.push({ channel, id: `group-${token}`, label: name, audience });
  };
  add(EVIL, isSt ? '邪惡群聊' : '陣營群聊', evil);
  if (lunatic) add(LUNATIC, isSt ? '瘋子群聊' : seat.id === lunatic.id ? '陣營群聊' : '群聊',
    [lunatic, ...fakeMinions]);
  return routes;
}

export function sendChat(room, seat, to, text) {
  if (!text) return '消息為空';
  const group = typeof to === 'string' && to.startsWith('group-') && groupChats(room, !seat, seat).find(g => g.id === to);
  const from = seat ? { from: seat.id, fromName: label(room, seat.id) } : { from: 'st', fromName: '說書人' };
  if (group) return pushChat(room, { ...from, to: group.channel, text, audience: group.audience });
  if (to === 'all' || (seat && to === 'st') || seatById(room, to)) return pushChat(room, { ...from, to, text });
  return '收件人不存在';
}
