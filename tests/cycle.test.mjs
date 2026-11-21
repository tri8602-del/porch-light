// Unit tests for the shared cycle math (cycle.js).
import { createRequire } from 'node:module';
const CY = createRequire(import.meta.url)('../cycle.js');
const res = []; const ok = (n, c, x = '') => { res.push(c); console.log(c ? 'PASS' : 'FAIL', '|', n, x ? '| ' + x : ''); };
const T = '2026-11-20';
const d = n => CY.addDays(T, -n);
let s = CY.summary([{ start: d(2) }], {}, T);
ok('defaults: 5 days unavailable, day 3', s.current && s.day === 3 && s.endsOn === d(-2), JSON.stringify([s.day, s.endsOn]));
ok('auto-ends after day 5', !CY.summary([{ start: d(5) }], {}, T).current);
ok('period length adjustable (7)', CY.summary([{ start: d(5) }], { periodDays: 7 }, T).day === 6);
ok('ended early today → not current', !CY.summary([{ start: d(2), end: T, early: true }], {}, T).current);
ok('explicit end date counts through that day', CY.summary([{ start: d(3), end: T }], {}, T).current);
ok('history cleaned: bad dates dropped, sorted, deduped', JSON.stringify(CY.clean([{ start: 'x' }, { start: d(40) }, { start: d(10) }, { start: d(10) }, { start: d(5), end: d(9) }]).map(e => e.start)) === JSON.stringify([d(40), d(10), d(5)]));
ok('end before start is ignored', !('end' in CY.clean([{ start: d(5), end: d(9) }]).find(e => e.start === d(5))));
// cycle length
ok('default cycle 28 with one period', CY.summary([{ start: d(10) }], {}, T).cycleLen === 28);
ok('average of history (30, 32 → 31)', CY.summary([{ start: d(72) }, { start: d(42) }, { start: d(10) }], {}, T).cycleLen === 31);
ok('manual cycle length overrides average', CY.summary([{ start: d(72) }, { start: d(42) }, { start: d(10) }], { cycleAuto: false, cycleDays: 26 }, T).cycleLen === 26);
ok('odd gaps (>45 days) ignored in average', CY.summary([{ start: d(110) }, { start: d(40) }, { start: d(10) }], {}, T).cycleLen === 30);
// starting soon
ok('day 24 → not soon (default 25)', !CY.summary([{ start: d(23) }], {}, T).soon);
ok('day 25 → starting soon', CY.summary([{ start: d(24) }], {}, T).soon);
ok('soon day adjustable (22)', CY.summary([{ start: d(21) }], { soonDay: 22 }, T).soon);
ok('soon stops a week after expected', !CY.summary([{ start: d(36) }], {}, T).soon);
ok('soon not shown during a period', !CY.summary([{ start: d(30) }, { start: d(1) }], {}, T).soon);
// fertile window
s = CY.summary([{ start: d(12) }], {}, T);
ok('fertile window = ovulation (next−14) −5 … +1', s.fertile.ovulation === CY.addDays(d(12), 14) && s.fertile.from === CY.addDays(d(12), 9) && s.fertile.to === CY.addDays(d(12), 15), JSON.stringify(s.fertile));
ok('today in fertile window (day 13)', s.inFertile);
ok('fertile offsets adjustable (−2/+0)', (() => { const f = CY.summary([{ start: d(12) }], { fertileBefore: 2, fertileAfter: 0 }, T).fertile; return f.from === CY.addDays(d(12), 12) && f.to === CY.addDays(d(12), 14); })());
ok('fertile follows average cycle length', CY.summary([{ start: d(72) }, { start: d(42) }, { start: d(10) }], {}, T).fertile.ovulation === CY.addDays(d(10), 31 - 14));
ok('settings clamped to sane ranges', (() => { const c = CY.cfgOf({ periodDays: 99, soonDay: 1, cycleDays: 'x', fertileBefore: -3 }); return c.periodDays === 10 && c.soonDay === 15 && c.cycleDays === 28 && c.fertileBefore === 0; })());
// what the partner sees
let pub = CY.publicView([{ start: d(40) }, { start: d(12) }], {}, T);
ok('shared view has only current period + dates, no history', JSON.stringify(Object.keys(pub)) === JSON.stringify(['cur', 'periodDays', 'soon', 'fertile']) && pub.cur.start === d(12));
ok('partner: fertile shown when shared', CY.publicNow(pub, T).fertile === true);
pub = CY.publicView([{ start: d(12) }], { shareFertile: false, shareSoon: false }, T);
ok('sharing off → no fertile/soon dates published', pub.fertile === null && pub.soon === null && CY.publicNow(pub, T).fertile === false);
pub = CY.publicView([{ start: d(2) }], { periodDays: 4 }, T);
ok('partner: period day + auto-end use her length', CY.publicNow(pub, T).day === 3 && CY.publicNow(pub, CY.addDays(T, 2)).active === false);
ok('partner: starting soon from her soon day', CY.publicNow(CY.publicView([{ start: d(25) }], {}, T), T).soon === true);
ok('null shared view is safe', CY.publicNow(null, T).active === false);
// import codes (made-up dates)
const fake = [{ start: '2025-03-03', end: '2025-03-07' }, { start: '2025-03-30', end: '2025-04-02' }, { start: '2025-04-24', end: '2025-04-29' }];
const code = CY.encodeImport(fake);
ok('encode → compact code', code === 'PL1:250303.5-250330.4-250424.6', code);
ok('parse round-trips', JSON.stringify(CY.parseImport(code, '2025-05-10').entries) === JSON.stringify(fake));
ok('parse accepts a pasted link with #import=', CY.parseImport('https://x/porch-light/#import=' + code, '2025-05-10').entries.length === 3);
ok('parse accepts "YYYY-MM-DD N" lines', CY.parseImport('2025-03-03 5\n2025-03-30, 4', '2025-05-10').entries.length === 2);
ok('parse rejects bad dates / future / silly lengths', (() => { const r = CY.parseImport('PL1:250231.5-990101.5-250303.30-250303.5', '2025-05-10'); return r.entries.length === 1 && r.bad.length === 3; })());
const plan = CY.importPlan([{ start: '2025-03-30', end: '2025-04-05' }, { start: '2025-02-01' }], { periodDays: 7, soonDay: 30 }, CY.parseImport(code, '2025-05-10').entries);
ok('import merges: same start replaced, others kept, sorted', JSON.stringify(plan.merged.map(e => e.start + '/' + (e.end || ''))) === JSON.stringify(['2025-02-01/', '2025-03-03/2025-03-07', '2025-03-30/2025-04-02', '2025-04-24/2025-04-29']));
ok('import sets typical length (median 5), average on, soon = avg − 3', plan.cycle.periodDays === 5 && plan.cycle.cycleAuto === true && plan.avgCycle === 27 && plan.cycle.soonDay === 24, JSON.stringify([plan.cycle, plan.avgCycle]));
ok('fertile window rolls to the next cycle once this one has passed', (() => { const f = CY.summary([{ start: d(24) }], {}, T).fertile; return f.ovulation === CY.addDays(d(24), 28 + 14); })());

console.log(`\nCYCLE: ${res.filter(Boolean).length}/${res.length} passed`);
process.exit(res.every(Boolean) ? 0 : 1);
