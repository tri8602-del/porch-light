// Sender tests: pure planning logic + full run against the Firestore emulator with real Web Push
// encryption (payloads are decrypted by a local fake push service to prove what a phone would show).
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8391';
import { createRequire } from 'node:module';
import https from 'node:https';
import fs from 'node:fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';  // local fake push service uses a self-signed cert
import crypto from 'node:crypto';
const require = createRequire(new URL('../sender/package.json', import.meta.url));
const admin = require('firebase-admin');
const webpush = require('web-push');
const ece = createRequire(import.meta.url)('http_ece');
const { plan, effectiveLevel, PAYLOADS } = await import('../sender/logic.mjs');
const { run } = await import('../sender/send.mjs');

const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);
const H = 3600e3;
// 2026-11-20 19:35 America/New_York == 2026-11-21 00:35Z
const EVENING = Date.parse('2026-11-21T00:35:00Z');
const NOON = Date.parse('2026-11-20T17:00:00Z');
const C = { members: ['L', 'M'], tracker: 'L' };
const fresh = (lvl, ago = 0.5) => ({ level: lvl, at: EVENING - ago * H, checkinOn: true, checkinTime: '19:30', tz: 'America/New_York' });

// ---- logic ----
ok('period → effective 0 (unavailable)', effectiveLevel({ level: 5, at: EVENING, period: { active: true } }, true, EVENING) === 0);
ok('period ignored for non-tracker', effectiveLevel({ level: 5, at: EVENING, period: { active: true } }, false, EVENING) === 5);
ok('stale after 8h default', effectiveLevel({ level: 5, at: EVENING - 9 * H }, false, EVENING) === null);
ok('custom staleHours 12 keeps it fresh at 9h', effectiveLevel({ level: 5, at: EVENING - 9 * H, staleHours: 12 }, false, EVENING) === 5);
let r = plan(C, { L: fresh(5), M: fresh(4) }, {}, NOON);
ok('match when both ≥4 → push to both', r.pushes.filter(p => p.type === 'match').map(p => p.uid).sort().join() === 'L,M');
ok('match payload is discreet', r.pushes[0].payload.body === "You're on the same page 💛" && !/sex|intim|mood|horny|bed/i.test(JSON.stringify(PAYLOADS)));
let r2 = plan(C, { L: fresh(5), M: fresh(5) }, r.server, NOON);
ok('no repeat match push while still matched', r2.pushes.length === 0);
let r3 = plan(C, { L: fresh(2), M: fresh(5) }, r2.server, NOON);
ok('match resets when one drops', r3.server.matchActive === false && r3.pushes.length === 0);
let r4 = plan(C, { L: fresh(4), M: fresh(5) }, r3.server, NOON);
ok('new match after reset notifies again', r4.pushes.filter(p => p.type === 'match').length === 2);
ok('no match when owner on period', plan(C, { L: { ...fresh(5), period: { active: true, start: '2026-11-19' } }, M: fresh(5) }, {}, NOON).pushes.length === 0);
ok('no match when one is stale', plan(C, { L: fresh(5, 10), M: fresh(5) }, {}, EVENING).pushes.filter(p => p.type === 'match').length === 0);
ok('no match with 3 (Maybe)', plan(C, { L: fresh(3), M: fresh(5) }, {}, NOON).pushes.length === 0);
ok('no pushes for a one-person couple', plan({ members: ['L'] }, { L: fresh(5) }, {}, EVENING).pushes.length === 0);
let c1 = plan(C, { L: fresh(1, 3), M: fresh(1, 3) }, {}, EVENING);
ok('evening check-in at 7:35 PM ET to both', c1.pushes.filter(p => p.type === 'checkin').length === 2 && c1.server.checkin.L === '2026-11-20');
ok('check-in payload discreet', c1.pushes[0].payload.body === 'Evening check-in 🌙 Tap to update.');
ok('check-in only once per day', plan(C, { L: fresh(1, 3), M: fresh(1, 3) }, c1.server, EVENING + 0.5 * H).pushes.length === 0);
ok('check-in next day sends again', plan(C, { L: fresh(1, 30), M: fresh(1, 30) }, c1.server, EVENING + 24 * H).pushes.filter(p => p.type === 'checkin').length === 2);
ok('no check-in before time (noon)', plan(C, { L: fresh(1, 3), M: fresh(1, 3) }, {}, NOON).pushes.length === 0);
ok('no check-in if >3h late', plan(C, { L: fresh(1, 30), M: fresh(1, 30) }, {}, EVENING + 3.5 * H).pushes.length === 0);
ok('check-in respects custom time 21:00', plan(C, { L: { ...fresh(1, 3), checkinTime: '21:00' }, M: fresh(1, 3) }, {}, EVENING).pushes.map(p => p.uid).join() === 'M');
ok('check-in off is respected', plan(C, { L: { ...fresh(1, 3), checkinOn: false }, M: fresh(1, 3) }, {}, EVENING).pushes.map(p => p.uid).join() === 'M');
const justUpdated = plan(C, { L: fresh(2, 0.2), M: fresh(1, 3) }, {}, EVENING);
ok('skip check-in if updated in last hour (but mark done)', justUpdated.pushes.map(p => p.uid).join() === 'M' && justUpdated.server.checkin.L === '2026-11-20');
ok('time zone honored (Chicago 7:30 = later UTC)', plan(C, { L: { ...fresh(1, 3), tz: 'America/Chicago' }, M: { ...fresh(1, 3), checkinOn: false } }, {}, EVENING).pushes.length === 0);

// ---- optional expiry ("until") ----
const NINE = Date.parse('2026-11-21T02:00:00Z');   // 9:00 PM ET
ok('until in future keeps level', effectiveLevel({ level: 4, at: EVENING, until: NINE }, false, NINE - 60e3) === 4);
ok('after until → Not tonight (1)', effectiveLevel({ level: 4, at: EVENING, until: NINE }, false, NINE) === 1);
ok('until as Firestore timestamp object works', effectiveLevel({ level: 5, at: EVENING, until: { _seconds: NINE / 1000, _nanoseconds: 0 } }, false, NINE + 1) === 1);
ok('until null = no end', effectiveLevel({ level: 5, at: EVENING, until: null }, false, EVENING + 3 * H) === 5);
const mU = plan(C, { L: fresh(5), M: { ...fresh(4), until: NINE } }, {}, NINE - 10 * 60e3);
ok('match before until time', mU.pushes.filter(p => p.type === 'match').length === 2);
const mU2 = plan(C, { L: fresh(5), M: { ...fresh(4), until: NINE } }, mU.server, NINE + 60e3);
ok('no match after until; match state resets', mU2.pushes.length === 0 && mU2.server.matchActive === false);
ok('no fresh match when one already expired', plan(C, { L: fresh(5), M: { ...fresh(5), until: NINE } }, {}, NINE + 5 * 60e3).pushes.filter(p => p.type === 'match').length === 0);

// ---- end to end against emulator ----
await fetch('http://127.0.0.1:8391/emulator/v1/projects/demo-porch/databases/(default)/documents', { method: 'DELETE' });
admin.initializeApp({ projectId: 'demo-porch' });
const db = admin.firestore();
const vapid = webpush.generateVAPIDKeys();
webpush.setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey);
const received = [];
const devices = {};
function mkDevice(name) { const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const auth = crypto.randomBytes(16); devices[name] = { ecdh, auth }; return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }; }
const server = https.createServer({ key: fs.readFileSync(new URL('./key.pem', import.meta.url)), cert: fs.readFileSync(new URL('./cert.pem', import.meta.url)) }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const name = req.url.slice(1);
    if (name === 'gone') { res.writeHead(410); res.end(); return; }
    const d = devices[name];
    const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString();
    received.push({ name, payload: JSON.parse(plain), vapid: /^vapid t=/.test(req.headers.authorization || ''), ttl: req.headers.ttl });
    res.writeHead(201); res.end();
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `https://127.0.0.1:${server.address().port}`;
const ref = db.collection('plCouples').doc('e2e');
await ref.set({ members: ['L', 'M'], owner: 'L', tracker: 'L', names: { owner: 'A', partner: 'B' } });
await ref.collection('people').doc('L').set({ level: 5, at: admin.firestore.Timestamp.fromMillis(EVENING - 3 * H), checkinTime: '19:30', tz: 'America/New_York' });
await ref.collection('people').doc('M').set({ level: 4, at: admin.firestore.Timestamp.fromMillis(EVENING - 2 * H), checkinTime: '19:30', tz: 'America/New_York' });
await ref.collection('subs').doc('L').set({ endpoints: { a: { endpoint: base + '/ownerPhone', keys: mkDevice('ownerPhone') } } });
await ref.collection('subs').doc('M').set({ endpoints: { a: { endpoint: base + '/partnerPhone', keys: mkDevice('partnerPhone') }, old: { endpoint: base + '/gone', keys: mkDevice('gone') } } });
const sendNotification = (s, p, o) => webpush.sendNotification(s, p, o).catch(e => { if (e.statusCode !== 410) console.log('SENDERR', e.statusCode, e.message, e.body); throw e; });
const s1 = await run({ db, sendNotification, now: EVENING });
ok('e2e run 1: match + check-in to both phones', s1.match === 2 && s1.checkin === 2 && received.filter(x => x.name === 'ownerPhone').length === 2 && received.filter(x => x.name === 'partnerPhone').length === 2, JSON.stringify(s1));
ok('e2e: payloads decrypt to discreet text', received.every(x => x.payload.title === 'Porch Light' && [PAYLOADS.match.body, PAYLOADS.checkin.body].includes(x.payload.body)));
ok('e2e: VAPID-signed with TTL', received.every(x => x.vapid && x.ttl === String(6 * 3600)));
ok('e2e: expired subscription (410) removed', s1.removed === 1 && !((await ref.collection('subs').doc('M').get()).data().endpoints.old));
const st = (await ref.collection('server').doc('state').get()).data();
ok('e2e: server state saved', st.matchActive === true && st.checkin.L === '2026-11-20' && st.checkin.M === '2026-11-20');
const n = received.length;
const s2 = await run({ db, sendNotification, now: EVENING + 5 * 60e3 });
ok('e2e run 2 (5 min later): nothing re-sent', received.length === n && s2.sent === 0, JSON.stringify(s2));
await ref.collection('people').doc('L').update({ period: { active: true, start: '2026-11-20' } });
await run({ db, sendNotification, now: EVENING + 10 * 60e3 });
ok('e2e: period clears the match state', (await ref.collection('server').doc('state').get()).data().matchActive === false);
// expiry end to end: rematch, then the until time passes
await ref.collection('people').doc('L').update({ period: { active: false } });
await ref.collection('people').doc('M').update({ until: admin.firestore.Timestamp.fromMillis(EVENING + 30 * 60e3) });
const before = received.length;
const s3 = await run({ db, sendNotification, now: EVENING + 15 * 60e3 });
ok('e2e: match pushed while before until', s3.match === 2 && received.length === before + 2, JSON.stringify(s3));
const s4 = await run({ db, sendNotification, now: EVENING + 31 * 60e3 });
ok('e2e: after until → match state cleared, nothing sent', s4.sent === 0 && (await ref.collection('server').doc('state').get()).data().matchActive === false);
server.close();
await ref.delete();

const fail = results.filter(r => r[0] === 'FAIL');
for (const x of results) console.log(x.filter(Boolean).join(' | '));
console.log(`\nSENDER: ${results.length - fail.length}/${results.length} passed`);
process.exit(fail.length ? 1 : 0);
