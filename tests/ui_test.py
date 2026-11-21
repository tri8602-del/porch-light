"""Porch Light two-phone UI test (Playwright + Firebase emulators). Usage: python3 ui_test.py"""
import asyncio, json, time, urllib.request, os, sys
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:8611/'
FS = 'http://127.0.0.1:8391'
PROJECT = 'demo-porch'
SHOTS = '/workspace/couples-app/shots'
os.makedirs(SHOTS, exist_ok=True)
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
NAME_A, NAME_B = (os.environ.get('PL_NAMES') or 'Alex,Sam').split(',')  # screenshots for review use real first names via env
TEST_VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
results = []
def ok(name, cond, extra=''):
    results.append(('PASS' if cond else 'FAIL', name, extra)); print(('PASS' if cond else 'FAIL'), '|', name, '|', extra, flush=True)

def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return {'_error': e.code, 'body': e.read().decode()[:300]}

def admin_get(path): return http('GET', f'{FS}/v1/projects/{PROJECT}/databases/(default)/documents/{path}')
def admin_patch(path, fields, mask):
    q = '&'.join('updateMask.fieldPaths=' + m for m in mask)
    return http('PATCH', f'{FS}/v1/projects/{PROJECT}/databases/(default)/documents/{path}?{q}', {'fields': fields})

STUB = """
Object.defineProperty(navigator, 'standalone', { get: () => %s });
(() => {
  // Fake push service: Chromium headless has no real one. Verifies the app's save path.
  const fakeSub = { endpoint: 'https://web.push.apple.com/fake-' + Math.random().toString(36).slice(2),
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BTestKey', auth: 'testAuth' } }; } };
  if (window.PushManager) {
    PushManager.prototype.subscribe = async function () { window.__subscribed = true; return fakeSub; };
    PushManager.prototype.getSubscription = async function () { return window.__subscribed ? fakeSub : null; };
  }
  window.__perm = localStorage.getItem('__perm') || 'default';
  if (localStorage.getItem('__perm')) window.__subscribed = true;
  if (window.Notification) {
    Object.defineProperty(Notification, 'permission', { get: () => window.__perm });
    Notification.requestPermission = async () => { localStorage.setItem('__perm', 'granted'); return (window.__perm = 'granted'); };
  }
  navigator.share = async (d) => { window.__shared = d; };
})();
"""

async def phone(browser, name, standalone=True):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True,
                                    has_touch=True, user_agent=UA, locale='en-US', timezone_id='America/New_York',
                                    service_workers='allow')
    await ctx.add_init_script(STUB % ('true' if standalone else 'false'))
    async def cfg(route):
        r = await route.fetch(); body = await r.text()
        await route.fulfill(response=r, body=body)
    await ctx.route('**/config.js', cfg)
    page = await ctx.new_page()
    page.on('pageerror', lambda e: print(f'[{name} pageerror]', e))
    page.name = name
    return ctx, page

async def shot(page, fname):
    await page.wait_for_timeout(350)
    await page.screenshot(path=f'{SHOTS}/{fname}')

async def visible(page, sel):
    return await page.locator(sel).is_visible()

async def main():
    http('DELETE', f'{FS}/emulator/v1/projects/{PROJECT}/databases/(default)/documents')
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---- 0. Safari (not installed) shows Home Screen steps, with the code from the link ----
        sctx, safari = await phone(b, 'safari', standalone=False)
        await safari.goto(BASE + '?emu=1&j=ABCD2345')
        await safari.wait_for_selector('#s-install:not(.hidden)')
        ok('Safari (not on Home Screen) shows install steps', await visible(safari, 'text=Add to Home Screen'))
        ok('install screen shows invite code', (await safari.text_content('#installCodeText')) == 'ABCD-2345')
        await shot(safari, '01-install-steps-safari.png')
        await sctx.close()

        # ---- 1. owner sets up ----
        lctx, L = await phone(b, 'owner')
        await L.goto(BASE + '?emu=1')
        await L.wait_for_selector('#s-welcome:not(.hidden)')
        await shot(L, '02-welcome.png')
        await L.click('#btnShowCreate')
        await L.fill('#myName', NAME_A); await L.fill('#partnerName', NAME_B)
        await shot(L, '03-setup-names.png')
        await L.click('#btnCreate')
        await L.wait_for_selector('#s-invite:not(.hidden)')
        code = (await L.text_content('#inviteCode')).replace('-', '')
        ok('invite code created (8 chars)', len(code) == 8, code)
        await shot(L, '04-invite-code.png')
        await L.click('#btnShare')
        shared = await L.evaluate('window.__shared')
        ok('share sheet gets link with code', shared and code in shared['url'] and 'Home Screen' in shared['text'], json.dumps(shared))
        await L.click('#btnInviteDone')
        await L.wait_for_selector('#s-notify:not(.hidden)')
        await shot(L, '05-turn-on-notifications.png')
        await L.click('#btnNotifyOn')
        await L.wait_for_selector('#s-home:not(.hidden)')
        cid = await L.evaluate('S.cid'); luid = await L.evaluate('S.user.uid')
        sub = admin_get(f'plCouples/{cid}/subs/{luid}')
        ok('owner push subscription saved', 'fields' in sub and 'endpoints' in sub['fields'], str(sub)[:120])
        await L.wait_for_selector('#pWait:not(.hidden)')
        ok('home shows partner not joined + code', fmt(code) in (await L.text_content('#pWait')))
        await shot(L, '06-owner-home-waiting.png')

        # ---- 2. partner joins from the link: code pre-filled, one tap ----
        mctx, M = await phone(b, 'partner')
        await M.goto(BASE + f'?emu=1&j={code}')
        await M.wait_for_selector('#s-welcome:not(.hidden)')
        ok('partner: code pre-filled from link', (await M.input_value('#joinCode')) == fmt(code))
        ok('partner: only Join shown (no setup option)', not await visible(M, '#btnShowCreate'))
        await shot(M, '07-partner-join-code-prefilled.png')
        await M.click('#btnJoin')
        await M.wait_for_selector('#s-notify:not(.hidden)')
        await M.click('#btnNotifyOn')
        await M.wait_for_selector('#s-home:not(.hidden)')
        muid = await M.evaluate('S.user.uid')
        ok('invite deleted after use', admin_get(f'plInvites/{code}').get('_error') == 404)
        ok('partner sees owner by name', (await M.text_content('#pName')) == NAME_A)
        await L.wait_for_function("document.getElementById('pName').textContent===%r && document.getElementById('pWait').classList.contains('hidden')" % NAME_B)
        ok('owner sees partner joined (live)', True)
        ok('partner has no note box (one-tap screen)', not await visible(M, '#noteRow'))
        ok('partner has no period button', not await visible(M, '#btnPeriod'))
        ok('owner has note box + period button', await visible(L, '#noteRow') and await visible(L, '#btnPeriod'))

        # ---- 3. partner reopens the app (as if tapping the evening push) and taps once ----
        await M.goto(BASE + '?emu=1&from=checkin')
        t0 = time.time()
        await M.wait_for_selector('#s-home:not(.hidden) .lv')
        await M.click('.lv[data-l="4"]')
        await M.wait_for_selector('.lv[data-l="4"].on')
        dt = time.time() - t0
        ok('partner: open → home → one tap saved', True, f'{dt:.1f}s in test browser')
        await shot(M, '08-partner-home-one-tap.png')
        await L.wait_for_function("document.getElementById('pLabel').textContent==='In the mood'")
        ok('owner sees partner’s update live', True)
        ok('no match yet (owner not set)', not await visible(L, '#matchBanner'))
        doc = admin_get(f'plCouples/{cid}/people/{muid}')
        ok('partner level stored = 4 with timestamp', doc['fields']['level'].get('integerValue') == '4' and 'timestampValue' in doc['fields']['at'])

        # ---- 4. owner: note + top level → match on both ----
        await L.fill('#noteInput', 'Kids asleep by 8 🙂'); await L.click('#btnNote')
        await L.click('.lv[data-l="5"]')
        await L.wait_for_selector('#matchBanner:not(.hidden)')
        await M.wait_for_selector('#matchBanner:not(.hidden)')
        ok('match banner shows on both phones', True)
        await M.wait_for_function("!document.getElementById('pNote').classList.contains('hidden')")
        ok('partner sees owner’s note', 'Kids asleep' in await M.text_content('#pNote'))
        await shot(L, '09-owner-home-match.png')
        await shot(M, '10-partner-home-match.png')

        # ---- 5. Period: one tap → unavailable for partner, match gone ----
        await L.click('#btnPeriod')
        await M.wait_for_function("document.getElementById('pLabel').textContent==='Unavailable'")
        ok('period started → partner sees Unavailable', True)
        ok('partner can see it is her period', 'Period' in await M.text_content('#pWhen'), await M.text_content('#pWhen'))
        await M.wait_for_selector('#matchBanner.hidden', state='attached')
        await L.wait_for_selector('#matchBanner.hidden', state='attached')
        ok('match cleared during period (both)', True)
        ok('owner sees her own unavailable note', await visible(L, '#periodOverlay'))
        await shot(L, '11-owner-period-on.png')
        await shot(M, '12-partner-sees-period.png')
        # backdate the start, end it → history + prediction
        await admin_patch_period(cid, luid)
        await L.wait_for_timeout(500)
        await L.click('#btnPeriod')   # Period ended
        await M.wait_for_function("document.getElementById('pLabel').textContent!=='Unavailable'")
        ok('period ended → partner sees her status again', (await M.text_content('#pLabel')) == 'Come find me')
        await L.click('#btnSettings')
        await L.wait_for_selector('#sheet:not(.hidden)')
        await L.wait_for_selector('#toast.hidden', state='attached')
        hist = await L.text_content('#periodHist'); pred = await L.text_content('#setPredict')
        ok('period history recorded, newest first', hist.index('Nov') < hist.index('Oct') < hist.index('Sep'), hist)
        ok('next period predicted', 'Next expected' in pred, pred)
        await shot(L, '13-owner-settings.png')
        await L.click('#btnCloseSettings')
        await M.click('#btnSettings'); await M.wait_for_selector('#sheet:not(.hidden)')
        ok('partner settings: no period section', not await visible(M, '#setPeriodGroup'))
        ok('partner settings: notifications show on', 'on' in await M.text_content('#notifyState'))
        await shot(M, '14-partner-settings.png')
        # change check-in time
        await M.fill('#setCheckinTime', '21:15'); await M.dispatch_event('#setCheckinTime', 'change')
        await M.wait_for_timeout(600)
        ok('check-in time saved', admin_get(f'plCouples/{cid}/people/{muid}')['fields']['checkinTime']['stringValue'] == '21:15')
        await M.click('#btnCloseSettings')

        # ---- 6. Stale: partner's update 10 hours old fades on owner's phone ----
        old = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 10 * 3600))
        admin_patch(f'plCouples/{cid}/people/{muid}', {'at': {'timestampValue': old}}, ['at'])
        await L.wait_for_selector('#partnerCard.stale')
        ok('stale status fades + says may be out of date', 'out of date' in await L.text_content('#pWhen'))
        await shot(L, '15-owner-sees-stale.png')
        await M.wait_for_timeout(500)
        ok('partner’s own stale level is un-selected with a refresh prompt', (await M.locator('.lv.on').count()) == 0 and 'Tap to update' in await M.text_content('#youTitle'))

        # ---- 7. A third person (stranger) cannot see anything ----
        xctx, X = await phone(b, 'stranger')
        await X.goto(BASE + '?emu=1')
        await X.wait_for_selector('#s-welcome:not(.hidden)')
        res = await X.evaluate(f"""async () => {{
          await auth.signInAnonymously();
          const out = {{}};
          const tryit = async (k, f) => {{ try {{ await f(); out[k] = 'allowed'; }} catch (e) {{ out[k] = e.code; }} }};
          await tryit('couple', () => db.collection('plCouples').doc('{cid}').get());
          await tryit('owner', () => db.collection('plCouples').doc('{cid}').collection('people').doc('{luid}').get());
          await tryit('people', () => db.collection('plCouples').doc('{cid}').collection('people').get());
          await tryit('join', () => db.collection('plCouples').doc('{cid}').update({{ members: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid), joinCode: '{code}' }}));
          await tryit('write', () => db.collection('plCouples').doc('{cid}').collection('people').doc(auth.currentUser.uid).set({{ level: 5 }}));
          const q = await db.collection('plCouples').where('members', 'array-contains', auth.currentUser.uid).get();
          out.ownQuery = q.size;
          return out;
        }}""")
        ok('stranger denied: couple/status/list/join/write', all(res[k] == 'permission-denied' for k in ['couple', 'owner', 'people', 'join', 'write']), json.dumps(res))
        ok('stranger finds no couple', res['ownQuery'] == 0)
        # reused code from the link also no longer works
        await X.fill('#joinCode', fmt(code)); await X.click('#btnJoin')
        await X.wait_for_function("document.getElementById('joinErr').textContent.length>0")
        ok('used invite code rejected for third person', True, await X.text_content('#joinErr'))
        await shot(X, '16-third-person-code-rejected.png')
        await xctx.close()

        # ---- 8. unauthenticated REST read is denied ----
        req = urllib.request.Request(f'{FS}/v1/projects/{PROJECT}/databases/(default)/documents/plCouples/{cid}/people/{luid}')
        try:
            urllib.request.urlopen(req); code_ = 200
        except urllib.error.HTTPError as e: code_ = e.code
        ok('unauthenticated read denied', code_ == 403, str(code_))

        await lctx.close(); await mctx.close(); await b.close()
    fails = [r for r in results if r[0] == 'FAIL']
    print(f'\nUI: {len(results) - len(fails)}/{len(results)} passed')
    sys.exit(1 if fails else 0)

def fmt(c): return c[:4] + '-' + c[4:]

async def admin_patch_period(cid, luid):
    start = time.strftime('%Y-%m-%d', time.localtime(time.time() - 4 * 86400))
    hist = {'arrayValue': {'values': [
        {'mapValue': {'fields': {'start': {'stringValue': time.strftime('%Y-%m-%d', time.localtime(time.time() - 33 * 86400))}, 'end': {'stringValue': time.strftime('%Y-%m-%d', time.localtime(time.time() - 28 * 86400))}}}},
        {'mapValue': {'fields': {'start': {'stringValue': time.strftime('%Y-%m-%d', time.localtime(time.time() - 63 * 86400))}, 'end': {'stringValue': time.strftime('%Y-%m-%d', time.localtime(time.time() - 58 * 86400))}}}},
    ]}}
    admin_patch(f'plCouples/{cid}/people/{luid}', {'period': {'mapValue': {'fields': {'active': {'booleanValue': True}, 'start': {'stringValue': start}}}}, 'periodHistory': hist}, ['period', 'periodHistory'])

asyncio.run(main())
