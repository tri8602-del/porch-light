/* Porch Light — a private two-person status app. */
'use strict';
const VERSION = '1.2.0';
const CY = window.PLCycle;
const CFG = window.PL_CONFIG || {};
const LEVELS = [null,
  { label: 'Not tonight',   emoji: '😴', c: 'var(--l1)' },
  { label: 'Just cuddles',  emoji: '🤗', c: 'var(--l2)' },
  { label: 'Maybe, ask me', emoji: '🙂', c: 'var(--l3)' },
  { label: 'In the mood',   emoji: '😊', c: 'var(--l4)' },
  { label: 'Come find me',  emoji: '😉', c: 'var(--l5)' },
];
const MATCH_MIN = 4, DEFAULT_STALE = 8, DEFAULT_CHECKIN = '19:30';
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const EMU = qs.has('emu') || sessionStorage.getItem('pl_emu') === '1';
if (EMU) sessionStorage.setItem('pl_emu', '1');

const S = { user: null, cid: null, couple: null, people: {}, unsub: [], saving: false };

// ---------- helpers ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
  window.scrollTo(0, 0);
}
function toast(msg, ms = 1800) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function fmtCode(c) { return c && c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : (c || ''); }
function newCode() { const b = new Uint32Array(8); crypto.getRandomValues(b); return [...b].map(x => CODE_ALPHA[x % CODE_ALPHA.length]).join(''); }
function ms(t) { if (!t) return null; if (typeof t === 'number') return t; if (t.toMillis) return t.toMillis(); if (t.seconds != null) return t.seconds * 1000; return null; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDay(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDay(s) { return parseDay(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function dayDiff(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 864e5); }
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function myTZ() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; } }
async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join(''); }

// Status rules shared with the sender: 0 = unavailable (period), null = not set / faded.
function effLevel(p, isTracker) {
  if (!p) return null;
  if (isTracker && CY.publicNow(p.cyclePub, today()).active) return 0;
  if (!Number.isInteger(p.level)) return null;
  const at = ms(p.at), st = (Number(p.staleHours) > 0 ? Number(p.staleHours) : DEFAULT_STALE) * 3600e3;
  if (at == null || Date.now() - at > st) return null;
  if (isExpired(p)) return 1;
  return p.level;
}
// Optional expiry: "In the mood until 9:00 PM", then it counts as Not tonight.
function untilMs(p) { return p ? ms(p.until) : null; }
function isExpired(p) { const u = untilMs(p); return u != null && Date.now() >= u; }
function fmtTime(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function untilOptions(now = Date.now()) {
  // the next three whole hours at least 30 minutes away
  const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  if (d.getTime() - now < 30 * 60e3) d.setHours(d.getHours() + 1);
  const out = []; for (let i = 0; i < 3; i++) { out.push(d.getTime()); d.setHours(d.getHours() + 1); }
  return out;
}
function isStale(p) {
  if (!p || !Number.isInteger(p.level)) return false;
  const at = ms(p.at), st = (Number(p.staleHours) > 0 ? Number(p.staleHours) : DEFAULT_STALE) * 3600e3;
  return at != null && Date.now() - at > st;
}

// ---------- Firebase ----------
let db, auth;
function initFirebase() {
  const fcfg = EMU ? { apiKey: 'demo-key', projectId: CFG.emulator.projectId, authDomain: 'localhost' } : CFG.firebase;
  firebase.initializeApp(fcfg);
  auth = firebase.auth(); db = firebase.firestore();
  if (EMU) { auth.useEmulator(CFG.emulator.auth, { disableWarnings: true }); db.useEmulator(CFG.emulator.firestoreHost, CFG.emulator.firestorePort); }
}
const FV = () => firebase.firestore.FieldValue;
async function ensureUser() {
  if (auth.currentUser) return auth.currentUser;
  const r = await auth.signInAnonymously();
  return r.user;
}
const coupleRef = () => db.collection('plCouples').doc(S.cid);
const meRef = () => coupleRef().collection('people').doc(S.user.uid);
// Her full period history + cycle settings: readable only by her.
const privRef = () => coupleRef().collection('private').doc(S.user.uid);

// ---------- invite code from link ----------
let linkCode = cleanCode(qs.get('j') || '');
if (linkCode.length !== 8) linkCode = '';
if (linkCode) {
  localStorage.setItem('pl_linkCode', linkCode);
  // Ask iOS to open the Home Screen app with the code already filled in (falls back to typing it).
  try {
    const base = new URL('./', location.href).href;
    const m = { name: 'Porch Light', short_name: 'Porch Light', start_url: base + '?j=' + linkCode, scope: base, display: 'standalone',
      background_color: '#ecebf2', theme_color: '#ecebf2',
      icons: [{ src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: base + 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
    $('manifestLink').href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
  } catch (e) {}
}
if (qs.has('j') || qs.has('from')) {
  const keep = EMU ? '?emu=1' : '';
  history.replaceState(null, '', location.pathname + keep);
}

// ---------- start ----------
async function start() {
  $('verText').textContent = 'Porch Light ' + VERSION;
  if ('serviceWorker' in navigator && !EMU) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (EMU && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const forceInstall = qs.has('install');
  if (forceInstall || (isIOS() && !isStandalone() && !localStorage.getItem('pl_skipInstall'))) {
    const code = linkCode || '';
    if (code) { $('installCode').classList.remove('hidden'); $('installCodeText').textContent = fmtCode(code); }
    show('s-install');
    return;
  }
  initFirebase();
  auth.onAuthStateChanged(async u => {
    if (!u) { showWelcome(); return; }
    S.user = u;
    try {
      const q = await db.collection('plCouples').where('members', 'array-contains', u.uid).limit(1).get();
      if (q.empty) { showWelcome(); return; }
      openCouple(q.docs[0].id);
      if (!localStorage.getItem('pl_notifyAsked')) show('s-notify'); else show('s-home');
    } catch (e) { showWelcome(); }
  });
}
function showWelcome() {
  const c = linkCode || localStorage.getItem('pl_linkCode') || '';
  if (c) $('joinCode').value = fmtCode(c);
  $('createWrap').classList.toggle('hidden', !!c);   // arriving with a code: just Join
  show('s-welcome');
}

$('btnSkipInstall').onclick = () => { localStorage.setItem('pl_skipInstall', '1'); location.replace(location.pathname + (EMU ? '?emu=1' : '')); };
$('btnShowCreate').onclick = () => { $('createCard').classList.remove('hidden'); $('myName').focus(); };
$('joinCode').addEventListener('input', e => { const c = cleanCode(e.target.value); e.target.value = c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c; });

$('btnCreate').onclick = async () => {
  const me = $('myName').value.trim(), partner = $('partnerName').value.trim();
  $('createErr').textContent = '';
  if (!me || !partner) { $('createErr').textContent = 'Add both first names.'; return; }
  $('btnCreate').disabled = true;
  try {
    const u = await ensureUser(); S.user = u;
    const ref = db.collection('plCouples').doc();
    await ref.set({ members: [u.uid], owner: u.uid, names: { owner: me, partner }, tracker: $('trackMine').checked ? u.uid : null, createdAt: FV().serverTimestamp() });
    S.cid = ref.id;
    await meRef().set({ checkinOn: true, checkinTime: DEFAULT_CHECKIN, tz: myTZ(), staleHours: DEFAULT_STALE, level: null });
    localStorage.setItem('pl_showNote', '1');
    await makeInvite();
    openCouple(ref.id);
    show('s-invite');
  } catch (e) { console.error(e); $('createErr').textContent = 'Could not set up just now. Check your connection and try again.'; }
  $('btnCreate').disabled = false;
};

async function makeInvite() {
  const code = newCode();
  const expires = firebase.firestore.Timestamp.fromMillis(Date.now() + 7 * 864e5);
  await db.collection('plInvites').doc(code).set({ cid: S.cid, expires, createdAt: FV().serverTimestamp() });
  await coupleRef().update({ joinCode: code });
  S.inviteCode = code;
  $('inviteCode').textContent = fmtCode(code);
  $('inviteExp').textContent = 'Works for 7 days, one time.';
  return code;
}
function inviteLink(code) { return new URL('./?j=' + code, location.href.split('?')[0]).href; }
async function shareInvite(code) {
  const url = inviteLink(code);
  const text = `Here's that app I mentioned. Open it in Safari, add it to your Home Screen, then type code ${fmtCode(code)}.`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Porch Light', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite copied — paste it in a text'); }
  catch { prompt('Copy this invite:', text + ' ' + url); }
}
$('btnShare').onclick = () => shareInvite(S.inviteCode);
$('btnInviteDone').onclick = () => { if (!localStorage.getItem('pl_notifyAsked')) show('s-notify'); else show('s-home'); };

$('btnJoin').onclick = async () => {
  const code = cleanCode($('joinCode').value);
  $('joinErr').textContent = '';
  if (code.length !== 8) { $('joinErr').textContent = 'The code has 8 letters and numbers.'; return; }
  $('btnJoin').disabled = true;
  try {
    const u = await ensureUser(); S.user = u;
    const inv = await db.collection('plInvites').doc(code).get();
    if (!inv.exists) throw new Error('nocode');
    const { cid, expires } = inv.data();
    if (ms(expires) < Date.now()) throw new Error('expired');
    await db.collection('plCouples').doc(cid).update({ members: FV().arrayUnion(u.uid), joinCode: code });
    S.cid = cid;
    await meRef().set({ checkinOn: true, checkinTime: DEFAULT_CHECKIN, tz: myTZ(), staleHours: DEFAULT_STALE, level: null });
    await db.collection('plInvites').doc(code).delete().catch(() => {});
    localStorage.removeItem('pl_linkCode');
    if (localStorage.getItem('pl_showNote') == null) localStorage.setItem('pl_showNote', '0');
    openCouple(cid);
    show('s-notify');
  } catch (e) {
    console.error(e);
    $('joinErr').textContent = e.message === 'expired' ? 'That code has expired — ask for a new one.' :
      e.message === 'nocode' ? "That code didn't work. Check it, or ask for a new one." : "Couldn't join. The code may be used already — ask for a new one.";
  }
  $('btnJoin').disabled = false;
};

// ---------- notifications ----------
function b64ToBytes(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error(isIOS() && !isStandalone() ? 'Open Porch Light from your Home Screen to turn these on.' : "This browser can't receive notifications.");
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are off. You can allow them in iPhone Settings → Notifications → Porch Light.');
  if (!CFG.vapidPublicKey) throw new Error('Notifications are not set up on the server yet.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
  const j = sub.toJSON();
  const key = await sha(j.endpoint);
  await coupleRef().collection('subs').doc(S.user.uid).set({ endpoints: { [key]: { endpoint: j.endpoint, keys: j.keys, at: Date.now() } } }, { merge: true });
  localStorage.setItem('pl_pushOn', '1');
  return true;
}
$('btnNotifyOn').onclick = async () => {
  $('notifyErr').textContent = ''; $('btnNotifyOn').disabled = true;
  try { await enablePush(); localStorage.setItem('pl_notifyAsked', '1'); toast('Check-ins are on 🌙'); show('s-home'); }
  catch (e) { $('notifyErr').textContent = e.message; }
  $('btnNotifyOn').disabled = false;
};
$('btnNotifySkip').onclick = () => { localStorage.setItem('pl_notifyAsked', '1'); show('s-home'); };

// ---------- couple + live updates ----------
function openCouple(cid) {
  S.cid = cid;
  S.unsub.forEach(f => f()); S.unsub = [];
  S.unsub.push(coupleRef().onSnapshot(d => {
    if (!d.exists) return;
    S.couple = d.data();
    if (!S.couple.members.includes(S.user.uid)) return;
    render();
  }, () => {}));
  S.unsub.push(coupleRef().collection('people').onSnapshot(q => {
    q.docChanges().forEach(ch => { if (ch.type === 'removed') delete S.people[ch.doc.id]; else S.people[ch.doc.id] = ch.doc.data(); });
    render();
  }, () => {}));
  S.priv = {};
  S.unsub.push(privRef().onSnapshot(d => { S.priv = d.exists ? d.data() : {}; S.privLoaded = true; render(); }, () => {}));
  // keep my time zone current for the evening check-in
  setTimeout(() => meRef().set({ tz: myTZ() }, { merge: true }).catch(() => {}), 500);
  clearInterval(S.tick); S.tick = setInterval(render, 60000);
}

function roles() {
  const c = S.couple || {}, uid = S.user && S.user.uid;
  const isOwner = c.owner === uid;
  const partnerUid = (c.members || []).find(x => x !== uid) || null;
  const names = c.names || {};
  return { c, uid, isOwner, partnerUid, myName: isOwner ? names.owner : names.partner, partnerName: (isOwner ? names.partner : names.owner) || 'Partner' };
}

function buildLevels() {
  const box = $('levels'); box.innerHTML = '';
  for (let i = 5; i >= 1; i--) {
    const L = LEVELS[i], b = document.createElement('button');
    b.className = 'lv'; b.dataset.l = i; b.style.setProperty('--c', L.c);
    b.innerHTML = `<span class="e">${L.emoji}</span><span>${L.label}</span>`;
    b.onclick = () => setLevel(i);
    box.appendChild(b);
  }
}
buildLevels();

async function setLevel(i) {
  if (!S.cid) return;
  const mine = S.people[S.user.uid] = { ...(S.people[S.user.uid] || {}), level: i, at: Date.now(), until: null };
  render(); flashSaved();
  try { await meRef().set({ level: i, at: FV().serverTimestamp(), until: null }, { merge: true }); }
  catch (e) { toast("Couldn't save — check your connection"); }
}
async function setUntil(t) {
  if (!S.cid) return;
  S.people[S.user.uid] = { ...(S.people[S.user.uid] || {}), until: t };
  render();
  try { await meRef().set({ until: t ? firebase.firestore.Timestamp.fromMillis(t) : null }, { merge: true }); toast(t ? 'Until ' + fmtTime(t) : 'No end time'); }
  catch (e) { toast("Couldn't save — check your connection"); }
}
function renderUntil(me, myLv) {
  const row = $('untilRow');
  const R = roles(); const onPer = R.c.tracker === R.uid && cyc().current;
  const show = Number.isInteger(myLv) && myLv >= 2 && !isExpired(me) && !onPer;
  row.classList.toggle('hidden', !show);
  if (!show) return;
  const cur = untilMs(me);
  const opts = untilOptions();
  if (cur && !opts.includes(cur)) opts.unshift(cur);
  const box = $('untilChips'); box.innerHTML = '';
  for (const t of opts.slice(0, 4)) {
    const b = document.createElement('button'); b.className = 'chip' + (cur === t ? ' on' : ''); b.dataset.t = t;
    b.textContent = fmtTime(t).replace(':00', ''); b.onclick = () => setUntil(t); box.appendChild(b);
  }
  const n = document.createElement('button'); n.className = 'chip' + (!cur ? ' on' : ''); n.dataset.t = '0';
  n.textContent = 'No end'; n.onclick = () => setUntil(null); box.appendChild(n);
}
function flashSaved() { const t = $('savedTick'); t.textContent = '✓ Saved'; clearTimeout(flashSaved._t); flashSaved._t = setTimeout(() => { t.textContent = ''; }, 2500); }

$('btnNote').onclick = async () => {
  const note = $('noteInput').value.trim().slice(0, 140);
  try { await meRef().set({ note, noteAt: FV().serverTimestamp() }, { merge: true }); toast(note ? 'Note saved' : 'Note cleared'); }
  catch { toast("Couldn't save — check your connection"); }
};

// ---------- period + cycle (owner side) ----------
function cyc() { return CY.summary((S.priv || {}).periodHistory, (S.priv || {}).cycle, today()); }
async function savePriv(patch) {
  const next = { periodHistory: CY.clean((S.priv || {}).periodHistory), cycle: CY.cfgOf((S.priv || {}).cycle), ...patch };
  next.periodHistory = CY.clean(next.periodHistory).slice(-48);
  S.priv = next; render();
  await privRef().set(next);
  await publishCycle(true);
}
// Share only what she allows (current period, and optionally "starting soon" / fertile dates).
async function publishCycle(force) {
  const R = roles(); if (!S.user || !S.privLoaded && !force) return;
  const me = S.people[R.uid] || {};
  const pub = R.c.tracker === R.uid ? CY.publicView((S.priv || {}).periodHistory, (S.priv || {}).cycle, today()) : null;
  if (JSON.stringify(pub) === JSON.stringify(me.cyclePub == null ? null : me.cyclePub)) return;
  S.people[R.uid] = { ...me, cyclePub: pub };
  // update() replaces the whole map (a merge would keep stale nested fields like an old end date)
  await meRef().update({ cyclePub: pub }).catch(() => meRef().set({ cyclePub: pub }, { merge: true }).catch(() => {}));
}
let psMode = null, psOrig = null;
function openPeriodSheet(mode, entry) {
  psMode = mode; psOrig = entry ? entry.start : null;
  const t = today(), cfg = cyc().cfg;
  $('psTitle').textContent = mode === 'start' ? 'Period started' : mode === 'add' ? 'Add a past period' : 'Edit period';
  $('psStart').max = t; $('psEnd').max = t;
  $('psStart').value = entry ? entry.start : t;
  $('psEnd').value = entry && entry.end ? entry.end : '';
  $('psEndRow').classList.toggle('hidden', mode === 'start');
  $('btnPsDelete').classList.toggle('hidden', mode !== 'edit');
  $('psHint').textContent = mode === 'start' ? `Pick an earlier day if you forgot to mark it. You'll show as unavailable for ${cfg.periodDays} days from the start, unless you tap Period ended sooner.`
    : `Leave the end date blank to count ${cfg.periodDays} days.`;
  $('periodSheet').classList.remove('hidden');
}
$('btnPsClose').onclick = () => $('periodSheet').classList.add('hidden');
$('periodSheet').addEventListener('click', e => { if (e.target.id === 'periodSheet') $('periodSheet').classList.add('hidden'); });
$('btnPsSave').onclick = async () => {
  const st = $('psStart').value, en = $('psEnd').value, t = today();
  if (!st || st > t) { toast('Pick a start date up to today'); return; }
  if (en && (en < st || en > t)) { toast('End date must be between the start and today'); return; }
  let hist = CY.clean((S.priv || {}).periodHistory).filter(e => e.start !== psOrig && e.start !== st);
  const e = { start: st }; if (en) e.end = en;
  hist.push(e);
  try { await savePriv({ periodHistory: hist }); $('periodSheet').classList.add('hidden'); toast(psMode === 'start' ? 'Marked — you show as unavailable' : 'Saved'); if (!$('sheet').classList.contains('hidden')) fillSettings(true); }
  catch { toast("Couldn't save — check your connection"); }
};
$('btnPsDelete').onclick = async () => {
  if (!confirm('Delete this period?')) return;
  try { await savePriv({ periodHistory: CY.clean((S.priv || {}).periodHistory).filter(e => e.start !== psOrig) }); $('periodSheet').classList.add('hidden'); toast('Deleted'); fillSettings(true); }
  catch { toast("Couldn't save"); }
};
$('btnPeriod').onclick = async () => {
  const c = cyc();
  if (!c.current) { openPeriodSheet('start'); return; }
  const t = today();
  const hist = c.history.map(e => e.start === c.current.start ? { start: e.start, end: t, early: true } : e);
  try { await savePriv({ periodHistory: hist }); toast('Period ended'); } catch { toast("Couldn't save — check your connection"); }
};
$('btnAddPast').onclick = () => openPeriodSheet('add');

function render() {
  if (!S.couple || !S.user) return;
  const R = roles();
  const me = S.people[R.uid] || {};
  const pp = R.partnerUid ? S.people[R.partnerUid] : null;
  const iTrack = R.c.tracker === R.uid, pTracks = R.partnerUid && R.c.tracker === R.partnerUid;
  const pNow = pTracks && pp ? CY.publicNow(pp.cyclePub, today()) : { active: false };
  const C = iTrack ? cyc() : null;
  if (iTrack && S.privLoaded) publishCycle(false);

  // Partner card
  $('pName').textContent = R.partnerName;
  const card = $('partnerCard');
  card.classList.remove('stale');
  $('pNote').classList.add('hidden'); $('pWait').classList.add('hidden');
  if (!R.partnerUid) {
    $('pEmoji').textContent = '✉️'; $('pLabel').textContent = 'Not joined yet'; $('pWhen').textContent = '';
    const w = $('pWait'); w.classList.remove('hidden');
    w.innerHTML = R.isOwner && R.c.joinCode ? `Their code: <b>${fmtCode(R.c.joinCode)}</b> &nbsp;<button class="btn small" id="btnShareWait">Send invite</button>` : 'Waiting for your partner to join.';
    const b = $('btnShareWait'); if (b) b.onclick = () => shareInvite(R.c.joinCode);
  } else if (pNow.active) {
    $('pEmoji').textContent = '🌸'; $('pLabel').textContent = 'Unavailable';
    $('pWhen').textContent = `Period · day ${pNow.day}`;
  } else if (!pp || !Number.isInteger(pp.level)) {
    $('pEmoji').textContent = '💭'; $('pLabel').textContent = 'No update yet'; $('pWhen').textContent = '';
  } else {
    const exp = isExpired(pp), pu = untilMs(pp);
    const L = LEVELS[exp ? 1 : pp.level];
    $('pEmoji').textContent = L.emoji; $('pLabel').textContent = L.label;
    const st = isStale(pp);
    $('pWhen').textContent = exp ? `“${LEVELS[pp.level].label}” ended at ${fmtTime(pu)}` : (pu && !st ? `until ${fmtTime(pu)} · ` : '') + ago(ms(pp.at) || Date.now()) + (st ? ' · may be out of date' : '');
    $('pWhen').classList.toggle('until', !!(pu && !exp && !st));
    if (st) card.classList.add('stale');
    const nAt = ms(pp.noteAt);
    if (pp.note && nAt && !st && !exp && Date.now() - nAt < (Number(pp.staleHours) || DEFAULT_STALE) * 3600e3) { $('pNote').textContent = '“' + pp.note + '”'; $('pNote').classList.remove('hidden'); }
  }

  // gentle shared cycle notes on the partner card
  const tags = [];
  if (R.partnerUid && pNow.soon) tags.push('<span class="tag soon">🌸 Period may start soon</span>');
  if (R.partnerUid && pNow.fertile) tags.push('<span class="tag fertile">Fertile window (est.)</span>');
  $('pTags').innerHTML = tags.join(''); $('pTags').classList.toggle('hidden', !tags.length);

  // Match
  const lvMe = effLevel(me, iTrack), lvP = R.partnerUid ? effLevel(pp, pTracks) : null;
  $('matchBanner').classList.toggle('hidden', !(lvMe != null && lvP != null && lvMe >= MATCH_MIN && lvP >= MATCH_MIN));

  // My buttons
  const myExp = !isStale(me) && Number.isInteger(me.level) && isExpired(me);
  const myLv = isStale(me) ? null : (myExp ? 1 : me.level);
  document.querySelectorAll('.lv').forEach(b => b.classList.toggle('on', Number(b.dataset.l) === myLv));
  $('youTitle').textContent = myExp ? `“${LEVELS[me.level].label}” ended at ${fmtTime(untilMs(me))}` : myLv ? 'How are you feeling?' : (Number.isInteger(me.level) ? 'Still feeling the same? Tap to update' : 'How are you feeling?');
  renderUntil(me, myLv);
  const onPeriod = !!(C && C.current);
  $('levels').classList.toggle('dim', !!onPeriod);
  $('periodOverlay').classList.toggle('hidden', !onPeriod);

  // Note (optional, mostly for the owner)
  const showNote = localStorage.getItem('pl_showNote') === '1';
  $('noteRow').classList.toggle('hidden', !showNote);
  if (showNote && document.activeElement !== $('noteInput')) $('noteInput').value = me.note || '';

  // Period toggle
  $('btnPeriod').classList.toggle('hidden', !iTrack);
  $('btnPeriod').classList.toggle('on', onPeriod);
  $('btnPeriod').textContent = onPeriod ? '🌸 Period ended' : '🌸 Period started';
  const box = $('cycleBox');
  if (C) {
    const L = [];
    if (C.current) L.push(`<div class="ln soon">🌸 <span><b>Period · day ${C.day} of ${C.cfg.periodDays}</b> — unavailable through ${fmtDay(C.endsOn)}</span></div>`);
    else if (C.soon) L.push(`<div class="ln soon">🌸 <span><b>Period starting soon</b> · expected around ${fmtDay(C.next)}</span></div>`);
    else if (C.next) L.push(`<div class="ln muted"><span>Next period expected around ${fmtDay(C.next)}</span></div>`);
    else L.push('<div class="ln muted"><span>Tap <b>Period started</b> to begin tracking.</span></div>');
    if (C.fertile && !C.current) {
      const t = today();
      if (C.inFertile) L.push(`<div class="ln fert">◌ <span><b>Fertile window</b> (estimate) · through ${fmtDay(C.fertile.to)}</span></div>`);
      else if (t < C.fertile.from) L.push(`<div class="ln fert">◌ <span>Fertile window (estimate) · ${fmtDay(C.fertile.from)} – ${fmtDay(C.fertile.to)}</span></div>`);
      if (C.inFertile || t < C.fertile.from) L.push('<div class="fine">Estimates only — not birth control.</div>');
    }
    box.innerHTML = L.join(''); box.classList.remove('hidden');
  } else box.classList.add('hidden');

  // flip an "until" status to Not tonight right when its time passes
  const next = [untilMs(me), pp ? untilMs(pp) : null].filter(t => t && t > Date.now()).sort((a, b) => a - b)[0];
  clearTimeout(S.untilTimer); if (next) S.untilTimer = setTimeout(render, Math.min(next - Date.now() + 300, 2 ** 31 - 1));
  if (!$('sheet').classList.contains('hidden')) fillSettings(false);
}

// ---------- settings ----------
function fillSettings(all = true) {
  const R = roles(); const me = S.people[R.uid] || {};
  if (all) {
    $('setCheckinOn').checked = me.checkinOn !== false;
    $('setCheckinTime').value = me.checkinTime || DEFAULT_CHECKIN;
    $('setStale').value = String(me.staleHours || DEFAULT_STALE);
    $('setShowNote').checked = localStorage.getItem('pl_showNote') === '1';
    $('setMyName').value = R.myName || ''; $('setPartnerName').value = R.partnerName === 'Partner' ? '' : R.partnerName;
    $('setTracker').checked = R.c.tracker === R.uid;
  }
  const pushOn = localStorage.getItem('pl_pushOn') === '1' && 'Notification' in window && Notification.permission === 'granted';
  $('notifyState').textContent = 'Notifications: ' + (pushOn ? 'on' : 'off');
  $('btnNotifyAgain').textContent = pushOn ? 'Re-check' : 'Turn on';
  const iTrack = R.c.tracker === R.uid;
  // Period section only for the person who tracks (or the owner, who can turn it on)
  $('setPeriodGroup').classList.toggle('hidden', !(iTrack || R.isOwner));
  $('cycleSettings').classList.toggle('hidden', !iTrack);
  if (iTrack) {
    const C = cyc(), cfg = C.cfg;
    document.querySelectorAll('#cycleSettings .step').forEach(el => { el.querySelector('span').textContent = cfg[el.dataset.k]; });
    $('setCycleAuto').checked = cfg.cycleAuto;
    $('cycleManualRow').classList.toggle('hidden', cfg.cycleAuto);
    $('setShareFertile').checked = cfg.shareFertile; $('setShareSoon').checked = cfg.shareSoon;
    const bits = [];
    if (C.next) bits.push(`Next period expected around ${fmtDay(C.next)} (${C.cycleAvg ? 'your ' + C.cycleLen + '-day average' : C.cycleLen + '-day cycle'}).`);
    if (C.fertile) bits.push(`Fertile window est. ${fmtDay(C.fertile.from)} – ${fmtDay(C.fertile.to)}.`);
    $('setPredict').textContent = bits.join(' ');
    const hist = C.history.slice().reverse();
    $('periodHist').innerHTML = hist.length ? hist.slice(0, 12).map(h => {
      const end = CY.effEnd(h, cfg), n = CY.diff(h.start, end) + 1;
      return `<div class="h" data-s="${h.start}"><span>${fmtDay(h.start)} – ${fmtDay(end)}${h.end ? '' : ' <span class="muted small">(auto)</span>'}</span><span>${n} day${n > 1 ? 's' : ''} ›</span></div>`;
    }).join('') : '<div class="hint">No periods yet.</div>';
    $('periodHist').querySelectorAll('.h').forEach(el => el.onclick = () => openPeriodSheet('edit', C.history.find(e => e.start === el.dataset.s)));
  }
  $('ownerTools').classList.toggle('hidden', !R.isOwner);
}
$('btnSettings').onclick = () => { fillSettings(true); $('sheet').classList.remove('hidden'); };
$('btnCloseSettings').onclick = () => $('sheet').classList.add('hidden');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').classList.add('hidden'); });
const saveMe = patch => meRef().set(patch, { merge: true }).then(() => toast('Saved'), () => toast("Couldn't save"));
$('setCheckinOn').onchange = e => saveMe({ checkinOn: e.target.checked });
$('setCheckinTime').onchange = e => { if (/^\d{2}:\d{2}$/.test(e.target.value)) saveMe({ checkinTime: e.target.value, tz: myTZ() }); };
$('setStale').onchange = e => saveMe({ staleHours: Number(e.target.value) });
$('setShowNote').onchange = e => { localStorage.setItem('pl_showNote', e.target.checked ? '1' : '0'); render(); };
$('setTracker').onchange = async e => {
  try { await coupleRef().update({ tracker: e.target.checked ? S.user.uid : null }); S.couple.tracker = e.target.checked ? S.user.uid : null; await publishCycle(true); toast('Saved'); fillSettings(false); render(); }
  catch { toast("Couldn't save"); }
};
const saveCycle = patch => savePriv({ cycle: { ...CY.cfgOf((S.priv || {}).cycle), ...patch } }).then(() => { fillSettings(true); toast('Saved'); }, () => toast("Couldn't save"));
document.querySelectorAll('#cycleSettings .step').forEach(el => {
  const [minus, , plus] = el.children;
  const bump = d => { const cfg = CY.cfgOf((S.priv || {}).cycle), k = el.dataset.k; const v = Math.min(+el.dataset.max, Math.max(+el.dataset.min, cfg[k] + d)); if (v !== cfg[k]) saveCycle({ [k]: v }); };
  minus.onclick = () => bump(-1); plus.onclick = () => bump(1);
});
$('setCycleAuto').onchange = e => saveCycle({ cycleAuto: e.target.checked });
$('setShareFertile').onchange = e => saveCycle({ shareFertile: e.target.checked });
$('setShareSoon').onchange = e => saveCycle({ shareSoon: e.target.checked });
function saveNames() {
  const R = roles();
  const mine = $('setMyName').value.trim().slice(0, 24), theirs = $('setPartnerName').value.trim().slice(0, 24);
  const names = { ...(R.c.names || {}) };
  if (R.isOwner) { if (mine) names.owner = mine; if (theirs) names.partner = theirs; } else { if (mine) names.partner = mine; if (theirs) names.owner = theirs; }
  coupleRef().update({ names }).then(() => toast('Saved'), () => toast("Couldn't save"));
}
$('setMyName').onchange = saveNames; $('setPartnerName').onchange = saveNames;
$('btnNotifyAgain').onclick = async () => { try { await enablePush(); toast('Notifications are on'); fillSettings(false); } catch (e) { toast(e.message, 3500); } };
$('btnReinvite').onclick = async () => {
  if (S.couple.members.length > 1) { toast('Your partner is already connected'); return; }
  try { const c = await makeInvite(); $('sheet').classList.add('hidden'); shareInvite(c); } catch { toast("Couldn't make a code"); }
};
$('btnUnpair').onclick = async () => {
  if (S.couple.members.length < 2) { toast('No partner connected'); return; }
  if (!confirm('Disconnect your partner? They will need a new code to join again.')) return;
  try { await coupleRef().update({ members: [S.user.uid], joinCode: '' }); toast('Disconnected'); } catch { toast("Couldn't disconnect"); }
};

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
start();
