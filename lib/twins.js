// 鏡像雙子局中變更：角色不變、陣營可能改變；配對只能連著能力持有者和一名相反陣營玩家。
import { charOf, fx, impaired, isGoodSeat, keptAbility, label, offline, pick, reallyAlive, roleName, seatById, stLog, tell } from './util.js';

// 初次配對仍由夜晚步驟處理。醉毒、普通死亡只暫停能力，保留原配對供恢復時重新核對。
// 官方允許死亡玩家成為雙子；沒有活候選時仍可選死候選，完全沒有相反陣營時等待合法對手出現。
// https://wiki.bloodontheclocktower.com/Evil_Twin
export function syncTwins(room) {
  const g = room.g, t = g?.twin;
  if (!t || room.phase === 'lobby' || room.phase === 'ended') return null;
  const holder = seatById(room, t.holder || t.evil);
  if (holder?.role !== 'eviltwin') {
    g.twin = null;
    g.twinHeld = false;
    return { changed: true, paired: false, reason: 'lost' };
  }
  if (!(reallyAlive(holder) || keptAbility(room, holder)) || impaired(room, holder)) return null;

  const good = isGoodSeat(holder), otherId = t.good === holder.id ? t.evil : t.evil === holder.id ? t.good : null;
  const other = seatById(room, otherId);
  // 對手換了角色不會重新獲知他的角色；兩人同時交換善惡也只重標記，不額外告知身份。
  if (other?.role && other !== holder && isGoodSeat(other) !== good) {
    const pair = pairOf(holder, other);
    if (samePair(t, pair)) return null;
    g.twin = pair;
    return { changed: true, paired: true, reason: 'alignment' };
  }

  const candidates = room.seats.filter(s => s !== holder && s.role && isGoodSeat(s) !== good);
  const living = candidates.filter(reallyAlive), next = pick(living.length ? living : candidates);
  if (!next) {
    const pending = { holder: holder.id, evil: good ? null : holder.id, good: good ? holder.id : null };
    if (samePair(t, pending)) return null;
    g.twin = pending;
    g.twinHeld = false;
    stLog(room, `${label(room, holder.id)} 的鏡像雙子配對暫停：沒有相反陣營的玩家`,
      { k: 'rule', seat: holder.id, role: 'eviltwin', work: false });
    return { changed: true, paired: false, reason: 'opponent' };
  }

  g.twin = pairOf(holder, next);
  g.twinHeld = false;
  // 臨時重新叫醒持有者仍是因為他自己的能力；新對手是因為別人的能力醒，不計入侍女。
  if (room.phase === 'night' && !(g.woke ||= []).includes(holder.id)) g.woke.push(holder.id);
  const tells = [tellTwin(room, holder, next), tellTwin(room, next, holder)];
  // 白天改陣營、入夜時酒醒等情況沒有當前能力卡，線下仍要提示說書人私下告知雙方。
  // 若當前夜晚步驟收集到同一條消息，engine 會按 msg 合併到 told，移除這份通用提示。
  if (offline(room)) (g.notice ||= []).push(...tells.map(t => ({ k: 'info', ...t })));
  stLog(room, `${label(room, holder.id)} 的鏡像雙子重新配對為 ${label(room, next.id)}`,
    { k: 'act', src: 'eviltwin', seat: holder.id, to: [next.id], res: 'master' });
  return { changed: true, paired: true, reason: 'repaired', tells };
}

const pairOf = (holder, other) => ({ holder: holder.id, evil: isGoodSeat(holder) ? other.id : holder.id, good: isGoodSeat(holder) ? holder.id : other.id });
const samePair = (a, b) => a.holder === b.holder && a.evil === b.evil && a.good === b.good;

function tellTwin(room, seat, other) {
  const role = charOf(other), f = [{ w: '雙子' }, { s: other.id }, { w: '是' }, { r: role, named: true }];
  tell(room, seat.id, `你的雙子是 ${label(room, other.id)}【${roleName(role)}】`,
    [{ seatId: other.id, r: role, text: roleName(role) }], { src: 'eviltwin', f });
  fx(room, { k: 'info', src: 'eviltwin', id: other.id, role, msg: room.chatSeq }, seat.id);
  return { seatId: seat.id, src: 'eviltwin', f, msg: room.chatSeq };
}
