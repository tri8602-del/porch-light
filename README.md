# Porch Light

A tiny private app for two people. Each of you taps one of five buttons to say how you're feeling, and you both see the other's current status. A quiet check-in arrives each evening, and you both get a heads-up when you're on the same page.

- **One screen, one tap.** Opening the app, or tapping the evening notification, lands on the main screen. Your partner's status is at the top, and your five buttons are below it. One tap saves.
- **Five levels:** Not tonight 😴 · Just cuddles 🤗 · Maybe, ask me 🙂 · In the mood 😊 · Come find me 😉.
- **Fades when old.** A status older than 8 hours fades and says "may be out of date". You can change the 8 hours in Settings.
- **Match.** When you're both at *In the mood* or *Come find me*, a banner appears and each of you gets a push. It is sent once per match.
- **Period tracking (optional, for whoever turns it on).** One tap marks "Period started" or "Period ended". While it's on, you show as *Unavailable · Period · day N*. The app keeps a history and predicts your next start from your average cycle.
- **Discreet.** The app name, icon, and push text are neutral. The lock screen only ever shows "Evening check-in 🌙 Tap to update." or "You're on the same page 💛".
- **Private.** Each of you signs in anonymously on your own phone. Firestore rules limit a couple's data to exactly its two members, and pairing uses a one-time invite code that expires after 7 days. This repo holds no personal data.

## How it fits together

| Piece | Where |
|---|---|
| App (PWA: Add to Home Screen) | `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, served by GitHub Pages |
| Data | Firestore collections `plCouples/…` and `plInvites/…` |
| Access rules | `firestore.rules` |
| Push sender (evening check-in + match) | `sender/send.mjs`, run every 5 minutes by `.github/workflows/push.yml` (free, no Cloud Functions or Blaze plan needed) |
| Firebase project / VAPID public key | `config.js` |

GitHub can delay scheduled runs by a few minutes. That means the evening check-in can arrive a little after the set time, and a match push can lag the in-app banner by about 5–15 minutes. The banner itself shows instantly when the app is open.

## One-time setup (owner)

1. **Firestore rules.** In the Firebase console, open the project → Firestore → Rules. Paste in the two `match` blocks from `firestore.rules` (`plCouples` and `plInvites`), then Publish.
   - If this project is shared with other apps, keep their rules exactly as they are.
   - Make sure no broad wildcard rule (`match /{document=**}`) allows reads for any signed-in user. Rules are OR'd together, so a rule like that would expose this data.
2. **Anonymous sign-in** must be enabled: Authentication → Sign-in method → Anonymous.
3. **Service account for the sender.** Go to Project settings → Service accounts → Generate new private key. Save the JSON contents as the repo secret `FIREBASE_SERVICE_ACCOUNT`.
4. **VAPID keys:** add the repo secrets `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT`. The public key must match `config.js`.
5. **GitHub Pages:** deploy from `main` (the root folder).

## Phones (iPhone, iOS 16.4+)

1. Open the link in **Safari** → Share → **Add to Home Screen**.
2. Open **Porch Light** from the Home Screen.
3. First person: tap **Set it up for the two of us**, type both first names, tap **Create**, then **Send invite**.
   Second person: the code is usually filled in already, so tap **Join**. Otherwise type the 8-character code.
4. Tap **Turn on notifications**, then **Allow**.

## Tests (local, Firebase emulators)

```
firebase emulators:start --only auth,firestore --project demo-porch   # ports in firebase.json
python3 -m http.server 8611 --bind 127.0.0.1
cd tests && npm i && node rules.test.mjs && node sender.test.mjs && python3 ui_test.py
```
In the app, `?emu=1` points it at the emulators.
