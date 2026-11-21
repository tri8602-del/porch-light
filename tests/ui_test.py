"""Porch Light two-phone UI test (Playwright + Firebase emulators). Usage: python3 ui_test.py"""
import asyncio, json, time, urllib.request, os, sys, datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
def et_today(h, m): return datetime.datetime.now(ET).replace(hour=h, minute=m, second=0, microsecond=0)
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

async def phone(browser, name, standalone=True, fixed=None):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True,
                                    has_touch=True, user_agent=UA, locale='en-US', timezone_id='America/New_York',
                                    service_workers='allow')
    await ctx.add_init_script(STUB % ('true' if standalone else 'false'))
    async def cfg(route):
        r = await route.fetch(); body = await r.text()
        await route.fulfill(response=r, body=body)
    await ctx.route('**/config.js', cfg)
    if fixed: await ctx.clock.set_fixed_time(fixed)   # device clock pinned for the 'until' screenshots
    page = await ctx.new_page()
    page.on('pageerror', lambda e: print(f'[{name} pageerror]', e))
    page.name = name
    return ctx, page

async def shot(page, fname, full=False):
    await page.wait_for_timeout(350)
    await page.screenshot(path=f'{SHOTS}/{fname}', full_page=full)

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
        lctx, L = await phone(b, 'owner', fixed=et_today(19, 35))
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
        mctx, M = await phone(b, 'partner', fixed=et_today(19, 35))
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
        await L.wait_for_function("document.getElementById('pLabel').textContent==='In the mood' && !document.getElementById('pWhen').textContent.includes('until')")
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

        # ---- 4b. Optional end time: partner taps a chip (or ignores it) ----
        await M.wait_for_selector('#untilRow:not(.hidden)')
        chips = await M.eval_on_selector_all('#untilChips .chip', 'els => els.map(e => e.textContent)')
        ok('after a tap, optional end-time chips appear', chips == ['9 PM', '10 PM', '11 PM', 'No end'], json.dumps(chips))
        ok('ignoring chips = no end time', 'until' not in admin_get(f'plCouples/{cid}/people/{muid}')['fields'] or 'nullValue' in admin_get(f'plCouples/{cid}/people/{muid}')['fields']['until'])
        await M.click('#untilChips .chip >> text="9 PM"')
        await M.wait_for_selector('#untilChips .chip.on >> text="9 PM"')
        await L.wait_for_function("document.getElementById('pLabel').textContent==='In the mood' && document.getElementById('pWhen').textContent.startsWith('until 9:00 PM')")
        ok('owner sees “In the mood until 9:00 PM”', True)
        ok('still a match before 9', await visible(L, '#matchBanner') and await visible(M, '#matchBanner'))
        await M.wait_for_selector('#toast.hidden', state='attached', timeout=4000)
        await shot(M, '10b-partner-until-9pm-chips.png')
        await shot(L, '10c-owner-sees-until-9pm.png')
        # 9:01 PM: status flips to Not tonight on both, match ends
        for pg in (L, M): await pg.clock.set_fixed_time(et_today(21, 1)); await pg.evaluate('render()')
        await L.wait_for_function("document.getElementById('pLabel').textContent==='Not tonight'")
        ok('after 9:00 owner sees “Not tonight”', 'ended at 9:00 PM' in await L.text_content('#pWhen'), await L.text_content('#pWhen'))
        ok('match gone after expiry (both)', not await visible(L, '#matchBanner') and not await visible(M, '#matchBanner'))
        ok('partner’s own screen shows it ended + Not tonight selected', 'ended at 9:00 PM' in await M.text_content('#youTitle') and await M.locator('.lv.on[data-l="1"]').count() == 1)
        ok('chips hidden once expired', not await visible(M, '#untilRow'))
        await shot(L, '10d-owner-sees-expired-not-tonight.png')
        await shot(M, '10e-partner-expired.png')
        await M.click('.lv[data-l="4"]')   # new tap clears the end time
        await M.wait_for_timeout(500)
        f = admin_get(f'plCouples/{cid}/people/{muid}')['fields']
        ok('new tap clears end time', 'nullValue' in f.get('until', {'nullValue': None}))
        await L.wait_for_function("document.getElementById('pLabel').textContent==='In the mood' && !document.getElementById('pWhen').textContent.includes('until')")

        # ---- 5. Period: pick a start date (can be earlier) → unavailable for N days ----
        L.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await L.click('#btnPeriod')
        await L.wait_for_selector('#periodSheet:not(.hidden)')
        ok('Period started opens a date picker defaulting to today', (await L.input_value('#psStart')) == day(0))
        await shot(L, '11-owner-period-date-picker.png')
        await L.fill('#psStart', day(2)); await L.click('#btnPsSave')
        await M.wait_for_function("document.getElementById('pLabel').textContent==='Unavailable'")
        ok('backdated start (2 days ago) → partner sees Unavailable · Period · day 3', (await M.text_content('#pWhen')) == 'Period · day 3', await M.text_content('#pWhen'))
        await M.wait_for_selector('#matchBanner.hidden', state='attached'); await L.wait_for_selector('#matchBanner.hidden', state='attached')
        ok('match cleared during period (both)', True)
        cb = await L.text_content('#cycleBox')
        ok('owner sees “Period · day 3 of 5 — unavailable through …”', 'day 3 of 5' in cb and 'through' in cb, cb)
        ok('owner sees her own unavailable note', await visible(L, '#periodOverlay'))
        await L.wait_for_selector('#toast.hidden', state='attached', timeout=4000)
        await shot(L, '12-owner-period-on.png', full=True)
        await shot(M, '12b-partner-sees-period.png')
        priv = await M.evaluate(f"""() => db.collection('plCouples').doc('{cid}').collection('private').doc('{luid}').get().then(() => 'allowed', e => e.code)""")
        ok('partner cannot read her private period history/settings', priv == 'permission-denied', priv)
        pub = admin_get(f'plCouples/{cid}/people/{luid}')['fields']['cyclePub']['mapValue']['fields']
        ok('shared status holds only the current period (no history)', set(pub.keys()) <= {'cur', 'periodDays', 'soon', 'fertile'})
        await L.click('#btnPeriod')   # Period ended early
        await M.wait_for_function("document.getElementById('pLabel').textContent!=='Unavailable'")
        ok('Period ended early → partner sees her status again', (await M.text_content('#pLabel')) == 'Come find me')

        # ---- 5b. History: add + edit past periods; adjust settings ----
        await L.click('#btnSettings'); await L.wait_for_selector('#sheet:not(.hidden)')
        await L.click('#btnAddPast'); await L.wait_for_selector('#periodSheet:not(.hidden)')
        await L.fill('#psStart', day(33)); await L.click('#btnPsSave'); await L.wait_for_selector('#periodSheet.hidden', state='attached')
        await L.click('#btnAddPast'); await L.fill('#psStart', day(63)); await L.fill('#psEnd', day(58)); await L.click('#btnPsSave')
        await L.wait_for_selector('#periodSheet.hidden', state='attached'); await L.wait_for_timeout(300)
        rows = await L.eval_on_selector_all('#periodHist .h', 'els => els.map(e => e.dataset.s)')
        ok('past periods added; history newest first', rows == [day(2), day(33), day(63)], json.dumps(rows))
        ok('blank end date = auto length', '(auto)' in await L.text_content(f'#periodHist .h[data-s="{day(33)}"]'))
        await L.click(f'#periodHist .h[data-s="{day(33)}"]'); await L.wait_for_selector('#periodSheet:not(.hidden)')
        ok('tapping a history row opens edit with delete', await visible(L, '#btnPsDelete') and (await L.input_value('#psStart')) == day(33))
        await L.fill('#psEnd', day(29)); await L.click('#btnPsSave'); await L.wait_for_timeout(400)
        ok('edited past period end date', '(auto)' not in await L.text_content(f'#periodHist .h[data-s="{day(33)}"]') and '5 days' in await L.text_content(f'#periodHist .h[data-s="{day(33)}"]'))
        # adjust settings
        async def step(k, d): await L.click(f'#cycleSettings .step[data-k="{k}"] button:{"last" if d > 0 else "first"}-child'); await L.wait_for_timeout(350)
        await step('periodDays', +1); await step('soonDay', -1)
        await L.click('#setCycleAuto'); await L.wait_for_timeout(350)
        ok('manual cycle length row appears when “use my average” is off', await visible(L, '#cycleManualRow'))
        await step('cycleDays', +1); await step('fertileBefore', -1); await step('fertileAfter', +1)
        cfg = admin_get(f'plCouples/{cid}/private/{luid}')['fields']['cycle']['mapValue']['fields']
        vals = {k: int(cfg[k]['integerValue']) for k in ['periodDays', 'soonDay', 'cycleDays', 'fertileBefore', 'fertileAfter']}
        ok('settings saved: period 6, soon day 24, cycle 29, fertile −4/+2', vals == {'periodDays': 6, 'soonDay': 24, 'cycleDays': 29, 'fertileBefore': 4, 'fertileAfter': 2}, json.dumps(vals))
        await L.evaluate("document.getElementById('setPeriodGroup').scrollIntoView()")
        await L.wait_for_selector('#toast.hidden', state='attached')
        await shot(L, '13-owner-settings-cycle.png')
        await L.evaluate("document.getElementById('periodHist').scrollIntoView({block:'center'})")
        await shot(L, '13b-owner-settings-history.png')
        # auto-end after N days: a period that started 5 days ago is day 6 of 6 → unavailable; set length back to 5 → auto-ended
        await L.click(f'#periodHist .h[data-s="{day(2)}"]'); await L.click('#btnPsDelete'); await L.wait_for_timeout(500)
        await L.click('#btnAddPast'); await L.fill('#psStart', day(5)); await L.click('#btnPsSave'); await L.wait_for_timeout(400)
        try: await M.wait_for_function("document.getElementById('pLabel').textContent==='Unavailable'", timeout=8000)
        except Exception:
            print('DEBUG priv', json.dumps(admin_get(f'plCouples/{cid}/private/{luid}'))[:900]); print('DEBUG pub', json.dumps(admin_get(f'plCouples/{cid}/people/{luid}').get('fields',{}).get('cyclePub'))[:600]); print('DEBUG M', await M.text_content('#pWhen'), await M.text_content('#pLabel'))
        ok('with length 6, a start 5 days ago is still day 6 → Unavailable', (await M.text_content('#pWhen')) == 'Period · day 6')
        await step('periodDays', -1)
        await M.wait_for_function("document.getElementById('pLabel').textContent!=='Unavailable'")
        ok('length back to 5 → period auto-ended for partner', True)
        await L.click('#btnCloseSettings')

        # ---- 5c. “Starting soon” and fertile window (owner + what partner may see) ----
        set_private(cid, luid, [{'start': day(25)}], {'periodDays': 5, 'soonDay': 25, 'cycleDays': 28, 'cycleAuto': True, 'fertileBefore': 5, 'fertileAfter': 1, 'shareFertile': True, 'shareSoon': True})
        await L.wait_for_function("document.getElementById('cycleBox').textContent.includes('starting soon')")
        ok('day 26 → owner sees “Period starting soon · expected around …”', 'expected around' in await L.text_content('#cycleBox'))
        await M.wait_for_function("document.getElementById('pTags').textContent.includes('may start soon')")
        ok('partner sees a gentle “Period may start soon” tag', True)
        await L.wait_for_selector('#toast.hidden', state='attached', timeout=4000)
        await shot(L, '14-owner-starting-soon.png', full=True)
        await shot(M, '14b-partner-starting-soon.png')
        set_private(cid, luid, [{'start': day(12)}], {'periodDays': 5, 'soonDay': 25, 'cycleDays': 28, 'cycleAuto': True, 'fertileBefore': 5, 'fertileAfter': 1, 'shareFertile': True, 'shareSoon': True})
        await L.wait_for_function("document.getElementById('cycleBox').textContent.includes('Fertile window')")
        cb = await L.text_content('#cycleBox')
        ok('day 13 of 28 → owner sees fertile window (estimate) + not-birth-control note', 'through' in cb and 'not birth control' in cb, cb)
        await M.wait_for_function("document.getElementById('pTags').textContent.includes('Fertile window')")
        ok('partner sees “Fertile window (est.)” when shared (default on)', True)
        await L.wait_for_selector('#toast.hidden', state='attached', timeout=4000)
        await shot(L, '15-owner-fertile-window.png', full=True)
        await shot(M, '15b-partner-fertile-window.png')
        await L.click('#btnSettings'); await L.wait_for_selector('#sheet:not(.hidden)')
        await L.click('#setShareFertile'); await L.wait_for_timeout(500); await L.click('#btnCloseSettings')
        await M.wait_for_function("!document.getElementById('pTags').textContent.includes('Fertile window')")
        pub = admin_get(f'plCouples/{cid}/people/{luid}')['fields']['cyclePub']['mapValue']['fields']
        ok('sharing off → partner tag gone and dates not published', 'nullValue' in pub['fertile'], json.dumps(pub['fertile']))
        ok('owner still sees her fertile window', 'Fertile window' in await L.text_content('#cycleBox'))
        await L.click('#btnSettings'); await L.wait_for_selector('#sheet:not(.hidden)')
        await L.click('#setShareFertile'); await L.wait_for_timeout(400); await L.click('#btnCloseSettings')

        await M.click('#btnSettings'); await M.wait_for_selector('#sheet:not(.hidden)')
        ok('partner settings: no period section', not await visible(M, '#setPeriodGroup'))
        ok('partner settings: notifications show on', 'on' in await M.text_content('#notifyState'))
        await shot(M, '16-partner-settings.png')
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
        await shot(L, '17-owner-sees-stale.png')
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
        await shot(X, '18-third-person-code-rejected.png')
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

def day(n): return (datetime.datetime.now(ET) - datetime.timedelta(days=n)).strftime('%Y-%m-%d')

def fsval(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [fsval(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: fsval(x) for k, x in v.items()}}}
    return {'nullValue': None}

def set_private(cid, uid, hist, cycle):
    admin_patch(f'plCouples/{cid}/private/{uid}', {'periodHistory': fsval(hist), 'cycle': fsval(cycle)}, ['periodHistory', 'cycle'])

asyncio.run(main())
