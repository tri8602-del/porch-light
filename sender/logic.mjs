// Pure planning logic for Porch Light pushes. No I/O here so it can be unit tested.
export const LEVELS = [
  null,
  { label: 'Not tonight', emoji: '😴' },
  { label: 'Just cuddles', emoji: '🤗' },
  { label: 'Maybe, ask me', emoji: '🙂' },
  { label: 'In the mood', emoji: '😊' },
  { label: 'Come find me', emoji: '😉' },
];
export const MATCH_MIN = 4;              // both at 4 or 5 = a match
export const DEFAULT_STALE_HOURS = 8;
export const DEFAULT_CHECKIN = '19:30';
export const DEFAULT_TZ = 'America/New_York';
export const CHECKIN_WINDOW_MIN = 180;   // don't send a check-in more than 3h late
export const RECENT_UPDATE_MIN = 60;     // skip the check-in if they updated in the last hour

// Discreet push text: nothing explicit ever reaches a lock screen.
export const PAYLOADS = {
  checkin: { title: 'Porch Light', body: 'Evening check-in 🌙 Tap to update.', tag: 'pl-checkin', url: './?from=checkin' },
  match:   { title: 'Porch Light', body: "You're on the same page 💛", tag: 'pl-match', url: './?from=match' },
};

export function toMillis(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t._seconds === 'number') return t._seconds * 1000 + Math.floor((t._nanoseconds || 0) / 1e6);
  if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
  return null;
}

// 0 = unavailable (period), 1..5 = level, null = not set or stale.
export function effectiveLevel(person, isTracker, nowMs) {
  if (!person) return null;
  if (isTracker && person.period && person.period.active) return 0;
  if (!Number.isInteger(person.level)) return null;
  const at = toMillis(person.at);
  const staleH = Number(person.staleHours) > 0 ? Number(person.staleHours) : DEFAULT_STALE_HOURS;
  if (at == null || nowMs - at > staleH * 3600e3) return null;
  return person.level;
}

export function localParts(nowMs, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  const p = Object.fromEntries(f.formatToParts(new Date(nowMs)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return hhmmToMin(DEFAULT_CHECKIN);
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/**
 * couple: { members:[uid,uid], tracker: uid|null }
 * people: { [uid]: personDoc }
 * server: { checkin: {[uid]: 'YYYY-MM-DD'}, matchActive: bool }
 * returns { pushes:[{uid,type,payload}], server: newServerState }
 */
export function plan(couple, people, server, nowMs) {
  const out = { pushes: [], server: { checkin: { ...((server && server.checkin) || {}) }, matchActive: !!(server && server.matchActive) } };
  const members = Array.isArray(couple && couple.members) ? couple.members : [];
  if (members.length !== 2) return out;

  // Match: both fresh and at the high end.
  const lv = members.map(u => effectiveLevel(people[u], couple.tracker === u, nowMs));
  const matched = lv.every(l => l != null && l >= MATCH_MIN);
  if (matched && !out.server.matchActive) {
    for (const u of members) out.pushes.push({ uid: u, type: 'match', payload: PAYLOADS.match });
  }
  out.server.matchActive = matched;

  // Evening check-in, once per local day per person.
  for (const u of members) {
    const p = people[u] || {};
    if (p.checkinOn === false) continue;
    const { date, minutes } = localParts(nowMs, p.tz);
    const target = hhmmToMin(p.checkinTime || DEFAULT_CHECKIN);
    if (out.server.checkin[u] === date) continue;
    if (minutes < target || minutes > target + CHECKIN_WINDOW_MIN) continue;
    out.server.checkin[u] = date;             // count it as done for today either way
    const at = toMillis(p.at);
    if (at != null && nowMs - at < RECENT_UPDATE_MIN * 60e3) continue;   // they just updated
    out.pushes.push({ uid: u, type: 'checkin', payload: PAYLOADS.checkin });
  }
  return out;
}
