// Firestore rules tests for Porch Light (run against the emulator on 127.0.0.1:8391).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, arrayUnion, Timestamp, serverTimestamp } from 'firebase/firestore';
import fs from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-porch-rules',
  firestore: { host: '127.0.0.1', port: 8391, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
await env.clearFirestore();
const L = env.authenticatedContext('ownerA').firestore();
const M = env.authenticatedContext('partnerB').firestore();
const X = env.authenticatedContext('stranger').firestore();
const U = env.unauthenticatedContext().firestore();
const results = [];
async function t(name, p) { try { await p; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const future = () => Timestamp.fromMillis(Date.now() + 7 * 864e5);

await t('owner creates couple', assertSucceeds(setDoc(doc(L, 'plCouples/c1'), { members: ['ownerA'], owner: 'ownerA', names: { owner: 'A', partner: 'B' }, tracker: 'ownerA', createdAt: serverTimestamp() })));
await t('cannot create couple listing someone else', assertFails(setDoc(doc(X, 'plCouples/c2'), { members: ['stranger', 'ownerA'], owner: 'stranger', names: {} })));
await t('cannot create couple owned by someone else', assertFails(setDoc(doc(X, 'plCouples/c3'), { members: ['stranger'], owner: 'ownerA', names: {} })));
await t('owner writes own people doc', assertSucceeds(setDoc(doc(L, 'plCouples/c1/people/ownerA'), { level: 5, at: serverTimestamp(), checkinOn: true, checkinTime: '19:30', tz: 'America/New_York', staleHours: 8 })));
await t('level out of range rejected', assertFails(setDoc(doc(L, 'plCouples/c1/people/ownerA'), { level: 9 }, { merge: true })));
await t('unknown field rejected', assertFails(setDoc(doc(L, 'plCouples/c1/people/ownerA'), { secret: 1 }, { merge: true })));
await t('stranger cannot make invite for c1', assertFails(setDoc(doc(X, 'plInvites/STRANGE1'), { cid: 'c1', expires: future() })));
await t('owner makes invite', assertSucceeds(setDoc(doc(L, 'plInvites/ABCDEFGH'), { cid: 'c1', expires: future(), createdAt: serverTimestamp() })));
await t('invite expiry > 8 days rejected', assertFails(setDoc(doc(L, 'plInvites/LONGLONG'), { cid: 'c1', expires: Timestamp.fromMillis(Date.now() + 30 * 864e5) })));
await t('owner stores joinCode while alone', assertSucceeds(updateDoc(doc(L, 'plCouples/c1'), { joinCode: 'ABCDEFGH' })));
await t('invites cannot be listed', assertFails(getDocs(collection(X, 'plInvites'))));
await t('unauthenticated cannot read invite', assertFails(getDoc(doc(U, 'plInvites/ABCDEFGH'))));
await t('stranger cannot read couple before join', assertFails(getDoc(doc(X, 'plCouples/c1'))));
await t('join with wrong code fails', assertFails(updateDoc(doc(M, 'plCouples/c1'), { members: arrayUnion('partnerB'), joinCode: 'ZZZZZZZZ' })));
await t('partner joins with code', assertSucceeds(updateDoc(doc(M, 'plCouples/c1'), { members: arrayUnion('partnerB'), joinCode: 'ABCDEFGH' })));
await t('third person cannot join a full couple', assertFails(updateDoc(doc(X, 'plCouples/c1'), { members: arrayUnion('stranger'), joinCode: 'ABCDEFGH' })));
await t('partner deletes used invite', assertSucceeds(deleteDoc(doc(M, 'plInvites/ABCDEFGH'))));
await t('partner reads couple', assertSucceeds(getDoc(doc(M, 'plCouples/c1'))));
await t('partner finds couple by query', assertSucceeds(getDocs(query(collection(M, 'plCouples'), where('members', 'array-contains', 'partnerB')))));
await t('partner writes own people doc', assertSucceeds(setDoc(doc(M, 'plCouples/c1/people/partnerB'), { level: 4, at: serverTimestamp() })));
await t('partner sets an until time (timestamp)', assertSucceeds(setDoc(doc(M, 'plCouples/c1/people/partnerB'), { until: Timestamp.fromMillis(Date.now() + 3600e3) }, { merge: true })));
await t('partner clears until (null)', assertSucceeds(setDoc(doc(M, 'plCouples/c1/people/partnerB'), { until: null }, { merge: true })));
await t('until must be a timestamp', assertFails(setDoc(doc(M, 'plCouples/c1/people/partnerB'), { until: '9pm' }, { merge: true })));
await t("partner cannot write owner's people doc", assertFails(setDoc(doc(M, 'plCouples/c1/people/ownerA'), { level: 1 }, { merge: true })));
await t("partner reads owner's status (incl. period)", assertSucceeds(getDoc(doc(M, 'plCouples/c1/people/ownerA'))));
await t('owner reads partner status', assertSucceeds(getDoc(doc(L, 'plCouples/c1/people/partnerB'))));
await t('owner writes private period history', assertSucceeds(setDoc(doc(L, 'plCouples/c1/private/ownerA'), { periodHistory: [{ start: '2026-11-16' }], cycle: { periodDays: 5 } })));
await t('owner reads own private doc', assertSucceeds(getDoc(doc(L, 'plCouples/c1/private/ownerA'))));
await t('partner cannot read her private doc', assertFails(getDoc(doc(M, 'plCouples/c1/private/ownerA'))));
await t('partner cannot write her private doc', assertFails(setDoc(doc(M, 'plCouples/c1/private/ownerA'), { periodHistory: [] })));
await t('stranger cannot read private doc', assertFails(getDoc(doc(X, 'plCouples/c1/private/ownerA'))));
await t('private doc rejects unknown fields', assertFails(setDoc(doc(L, 'plCouples/c1/private/ownerA'), { notes: 'x' })));
await t('private history capped at 60', assertFails(setDoc(doc(L, 'plCouples/c1/private/ownerA'), { periodHistory: Array.from({ length: 61 }, (_, i) => ({ start: '2020-01-01' })) })));
await t('owner publishes shared cycle view on status', assertSucceeds(setDoc(doc(L, 'plCouples/c1/people/ownerA'), { cyclePub: { cur: { start: '2026-11-16' }, periodDays: 5, soon: null, fertile: null } }, { merge: true })));
await t('old period field no longer accepted on status', assertFails(setDoc(doc(L, 'plCouples/c1/people/ownerA'), { periodHistory: [] }, { merge: true })));
await t('stranger cannot read couple', assertFails(getDoc(doc(X, 'plCouples/c1'))));
await t('stranger cannot read statuses', assertFails(getDoc(doc(X, 'plCouples/c1/people/ownerA'))));
await t('stranger cannot list statuses', assertFails(getDocs(collection(X, 'plCouples/c1/people'))));
await t('stranger query finds nothing of theirs / denied for others', assertFails(getDocs(query(collection(X, 'plCouples'), where('members', 'array-contains', 'ownerA')))));
await t('stranger cannot write a status into couple', assertFails(setDoc(doc(X, 'plCouples/c1/people/stranger'), { level: 5 })));
await t('unauthenticated cannot read couple', assertFails(getDoc(doc(U, 'plCouples/c1'))));
await t('unauthenticated cannot read statuses', assertFails(getDoc(doc(U, 'plCouples/c1/people/ownerA'))));
await t('push sub: own write ok', assertSucceeds(setDoc(doc(M, 'plCouples/c1/subs/partnerB'), { endpoints: { k: { endpoint: 'https://x', keys: {} } } })));
await t("push sub: partner cannot read other's", assertFails(getDoc(doc(L, 'plCouples/c1/subs/partnerB'))));
await t('push sub: stranger cannot read', assertFails(getDoc(doc(X, 'plCouples/c1/subs/partnerB'))));
await t('server state: clients cannot read', assertFails(getDoc(doc(L, 'plCouples/c1/server/state'))));
await t('server state: clients cannot write', assertFails(setDoc(doc(M, 'plCouples/c1/server/state'), { matchActive: false })));
await t('partner cannot change owner', assertFails(updateDoc(doc(M, 'plCouples/c1'), { owner: 'partnerB' })));
await t('partner cannot remove owner', assertFails(updateDoc(doc(M, 'plCouples/c1'), { members: ['partnerB'] })));
await t('partner may edit names', assertSucceeds(updateDoc(doc(M, 'plCouples/c1'), { names: { owner: 'A', partner: 'B2' } })));
await t('stranger cannot edit names', assertFails(updateDoc(doc(X, 'plCouples/c1'), { names: { owner: 'x', partner: 'y' } })));
await t('partner cannot delete couple', assertFails(deleteDoc(doc(M, 'plCouples/c1'))));
await t('owner can disconnect partner', assertSucceeds(updateDoc(doc(L, 'plCouples/c1'), { members: ['ownerA'], joinCode: '' })));
await t('disconnected partner can no longer read', assertFails(getDoc(doc(M, 'plCouples/c1/people/ownerA'))));
await t('expired invite cannot be used', (async () => {
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'plInvites/OLDOLDOL'), { cid: 'c1', expires: Timestamp.fromMillis(Date.now() - 1000) }); });
  await assertFails(updateDoc(doc(X, 'plCouples/c1'), { members: arrayUnion('stranger'), joinCode: 'OLDOLDOL' }));
})());

await env.cleanup();
const fail = results.filter(r => r[0] === 'FAIL');
for (const r of results) console.log(r.join(' | '));
console.log(`\nRULES: ${results.length - fail.length}/${results.length} passed`);
process.exit(fail.length ? 1 : 0);
