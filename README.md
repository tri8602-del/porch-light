# Porch Light

A tiny private app for two people. Each of you slides one slider to say how you're feeling, and you both see the other's current status. A quiet check-in arrives each evening, and you both get a heads-up when you're on the same page.

- **One screen, one move.** Opening the app, or tapping the evening notification, lands on the main screen. Your partner's status is at the top, and your slider is below it. Drag and let go, or tap one of the five icons, and it saves automatically.
- **A slider from 1.0 to 5.0** with five icon anchors: Not tonight (moon) · Just cuddles (heart) · Maybe, ask me (speech bubble) · In the mood (sun) · Come find me (sparkle). In-between values are kept (e.g. "Between Maybe and In the mood"). A match needs both at 4.0 or higher.
- **Last updated.** Under each mood is a small gray line such as *Updated Today · 9:12 PM* or *Updated Tue, Nov 17 · 8:40 PM*. An old status also fades and says *May be out of date* (after the stale setting, 8 hours by default).
- **Ping to update.** A small button on the partner card sends them a discreet push ("Porch Light — Tap to update your light"). You can ping once every 30 minutes (the rules enforce it too). The scheduled sender delivers it, so it arrives within about 5–15 minutes. It's skipped if they've already updated.
- **Estimated end dates.** *Period · day 2 of 5 · ends around Nov 25*. *Expected Nov 21 – Nov 25* when one is coming up. Fertile window *Nov 28 – Dec 4* when upcoming, *ends Dec 4* while it's on. Her partner's card shows the same dates for whatever she shares.
- **Optional end time.** After a tap, a small row of chips appears: the next three whole hours and *No end*. Ignoring it means no end time. *Custom…* lets you pick an exact time or a duration (hours and minutes, or quick 30 min / 1 / 2 / 3 hr). When the chosen time passes, the status counts as *Not tonight*, both on screen ("“In the mood” ended at 9:00 PM") and in match logic.
- **Fades when old.** A status older than 8 hours fades and says "may be out of date". You can change the 8 hours in Settings.
- **Match.** When you're both at *In the mood* or *Come find me*, a banner appears and each of you gets a push. It is sent once per match.
- **Period tracking (optional, for whoever turns it on).** *Period started* opens a date picker. It defaults to today, and earlier dates work if you forgot to mark it. From the start you show as *Unavailable · Period · day N* for 5 days, unless you tap *Period ended* sooner. After that it ends on its own. You can add or edit past periods in Settings, or bring in a whole history at once with **Settings → Import history**: paste a one-time `PL1:` code, check the preview, then tap Import. The code stays on the phone, and a start date that's already there is replaced, not duplicated.
- **Cycle notes (her screen).** From day 25 she sees *Period starting soon* with the expected date. She also sees an estimated fertile window: ovulation is taken as about 14 days before the next expected start, and the window runs from 5 days before to 1 day after it. The cycle length is 28 days or her average. She can adjust every number in Settings, and she chooses whether her partner sees the *starting soon* and *fertile window* tags (both on by default). Her full history and settings sit in a private document only she can read. Her partner's phone only gets what she shares.
- **Discreet.** The app name, icon, and push text are neutral. The lock screen only ever shows "Evening check-in 🌙 Tap to update." or "You're on the same page 💛".
- **Private.** Each of you signs in anonymously on your own phone. Firestore rules limit a couple's data to exactly its two members, and pairing uses a one-time invite code that expires after 7 days. This repo holds no personal data.

## How it fits together

| Piece | Where |
|---|---|
| App (PWA: Add to Home Screen) | `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, served by GitHub Pages |
| Data | Firestore collections `plCouples/…` and `plInvites/…` |
| Access rules | `firestore.rules` |
| Cycle math (shared by app and sender) | `cycle.js` |
| Push sender (evening check-in + match) | `sender/send.mjs`, run every 5 minutes by `.github/workflows/push.yml` (free, no Cloud Functions or Blaze plan needed) |
| Firebase project (`porch-light-84ac9`, its own project) / VAPID public key | `config.js` |

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
cd tests && npm i && node cycle.test.mjs && node rules.test.mjs && node sender.test.mjs && python3 ui_test.py
```
In the app, `?emu=1` points it at the emulators.
