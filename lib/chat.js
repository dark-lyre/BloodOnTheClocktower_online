import { createHmac } from 'node:crypto';
import { isEvil, label, oneDevice, pushChat, seatById, teamOf } from './util.js';

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
  // 這兩種角色不知道自己的真實身份，不能因為看到真正的邪惡群聊而得知。
  const evil = room.seats.filter(s => isEvil(s) && s.role !== 'marionette' && s.role !== 'lunatic');
  const lunatics = room.seats.filter(s => s.role === 'lunatic');
  const routes = [];
  const add = (channel, name, seats) => {
    const audience = seats.map(s => s.id);
    if (!audience.length || (!isSt && !audience.includes(seat.id))) return;
    // 只向這個視角提供可用的頻道代號。瘋子和惡魔都看見同樣的入口，代號不透露實際群組。
    const token = createHmac('sha256', room.stKey).update(JSON.stringify([game, isSt ? 'st' : seat.id, channel])).digest('hex').slice(0, 24);
    routes.push({ channel, id: `group-${token}`, label: name, audience });
  };
  add(EVIL, isSt ? '邪惡群聊' : '陣營群聊', evil);
  if (lunatics.length) add(LUNATIC, isSt || seat.role !== 'lunatic' ? '瘋子群聊' : '陣營群聊',
    [...lunatics, ...evil.filter(s => teamOf(s) === 'minion')]);
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
