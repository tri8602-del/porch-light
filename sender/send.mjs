// Porch Light push sender. Runs from GitHub Actions on a schedule (or by hand).
// Needs env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
// and FIREBASE_SERVICE_ACCOUNT (JSON) — or FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT for tests.
// Logs print counts only: Actions logs on a public repo are public.
import admin from 'firebase-admin';
import webpush from 'web-push';
import { plan } from './logic.mjs';

export async function run({ db, sendNotification, now = Date.now() }) {
  const stats = { couples: 0, checkin: 0, match: 0, sent: 0, failed: 0, removed: 0 };
  const snap = await db.collection('plCouples').get();
  for (const doc of snap.docs) {
    const couple = doc.data();
    if (!Array.isArray(couple.members) || couple.members.length !== 2) continue;
    stats.couples++;
    const people = {};
    for (const u of couple.members) {
      const p = await doc.ref.collection('people').doc(u).get();
      if (p.exists) people[u] = p.data();
    }
    const stateRef = doc.ref.collection('server').doc('state');
    const stateSnap = await stateRef.get();
    const result = plan(couple, people, stateSnap.exists ? stateSnap.data() : {}, now);
    for (const push of result.pushes) {
      stats[push.type]++;
      const subRef = doc.ref.collection('subs').doc(push.uid);
      const sub = await subRef.get();
      const endpoints = (sub.exists && sub.data().endpoints) || {};
      for (const [key, s] of Object.entries(endpoints)) {
        try {
          await sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(push.payload), { TTL: 6 * 3600, urgency: 'normal', topic: push.payload.tag });
          stats.sent++;
        } catch (e) {
          stats.failed++;
          if (e && (e.statusCode === 404 || e.statusCode === 410)) {
            await subRef.update({ [`endpoints.${key}`]: admin.firestore.FieldValue.delete() });
            stats.removed++;
          }
        }
      }
    }
    await stateRef.set(result.server, { merge: false });
  }
  return stats;
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('Porch Light sender: FIREBASE_SERVICE_ACCOUNT secret not set yet — nothing to do.');
    return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.log('Porch Light sender: VAPID keys not set — nothing to do.');
    return;
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  } else {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-porch' });
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:porchlight@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const stats = await run({ db: admin.firestore(), sendNotification: webpush.sendNotification.bind(webpush), now: process.env.PL_NOW ? Number(process.env.PL_NOW) : Date.now() });
  console.log('Porch Light sender:', JSON.stringify(stats));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('Porch Light sender failed:', e && e.message ? e.message : 'error'); process.exit(1); });
}
