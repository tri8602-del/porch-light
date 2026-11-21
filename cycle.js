/* Porch Light cycle math, shared by the app (window.PLCycle) and the push sender (require).
   Dates are local calendar days as 'YYYY-MM-DD'. Everything here is an estimate. */
(function (root) {
  'use strict';
  const DEFAULTS = { periodDays: 5, soonDay: 25, cycleDays: 28, cycleAuto: true, fertileBefore: 5, fertileAfter: 1, shareFertile: true, shareSoon: true };
  const LIMITS = { periodDays: [1, 10], soonDay: [15, 40], cycleDays: [20, 45], fertileBefore: [0, 8], fertileAfter: [0, 4] };
  const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  function cfgOf(c) {
    const o = { ...DEFAULTS, ...(c || {}) };
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) { const n = Math.round(Number(o[k])); o[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[k]; }
    o.cycleAuto = o.cycleAuto !== false; o.shareFertile = o.shareFertile !== false; o.shareSoon = o.shareSoon !== false;
    return o;
  }
  function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function diff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function clean(hist) {
    const seen = new Map();
    for (const e of Array.isArray(hist) ? hist : []) {
      if (!e || !isDay(e.start)) continue;
      const x = { start: e.start };
      if (isDay(e.end) && e.end >= e.start) { x.end = e.end; if (e.early) x.early = true; }
      seen.set(x.start, x);
    }
    return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
  }
  function effEnd(e, cfg) { return isDay(e.end) ? e.end : addDays(e.start, cfg.periodDays - 1); }
  // On her period today? Auto-ends after periodDays; "Period ended" early sets end=today+early (available from then).
  function activeEntry(e, today, cfg) {
    if (!e || !isDay(e.start) || today < e.start) return false;
    const end = effEnd(e, cfg);
    if (today > end) return false;
    if (e.early && today === e.end) return false;
    return true;
  }
  function cycleLength(h, cfg) {
    if (!cfg.cycleAuto) return { len: cfg.cycleDays, avg: false, n: 0 };
    const gaps = [];
    for (let i = 1; i < h.length; i++) { const g = diff(h[i - 1].start, h[i].start); if (g >= 18 && g <= 45) gaps.push(g); }
    const r = gaps.slice(-6);
    if (!r.length) return { len: cfg.cycleDays, avg: false, n: 0 };
    return { len: Math.round(r.reduce((a, b) => a + b, 0) / r.length), avg: true, n: r.length };
  }
  function summary(hist, cfgIn, today) {
    const cfg = cfgOf(cfgIn), h = clean(hist);
    const past = h.filter(e => e.start <= today), last = past[past.length - 1] || null;
    const current = last && activeEntry(last, today, cfg) ? last : null;
    const cl = cycleLength(h, cfg);
    const out = { cfg, history: h, last, current, day: current ? diff(current.start, today) + 1 : null, endsOn: current ? effEnd(current, cfg) : null,
      cycleLen: cl.len, cycleAvg: cl.avg, next: null, nextEnd: null, soon: false, soonFrom: null, fertile: null, inFertile: false, dayOfCycle: null };
    if (last) {
      out.dayOfCycle = diff(last.start, today) + 1;
      out.next = addDays(last.start, cl.len);
      out.nextEnd = addDays(out.next, cfg.periodDays - 1);   // estimated last day of the next period
      out.soonFrom = addDays(last.start, cfg.soonDay - 1);
      out.soon = !current && today >= out.soonFrom && diff(out.next, today) <= 7;   // until a week late
      // this cycle's estimated window; once it has passed, show the next cycle's
      let base = out.next, ov, k = 0;
      do { ov = addDays(base, -14); if (today <= addDays(ov, cfg.fertileAfter)) break; base = addDays(base, cl.len); } while (++k < 3);
      out.fertile = { from: addDays(ov, -cfg.fertileBefore), to: addDays(ov, cfg.fertileAfter), ovulation: ov };
      out.inFertile = !current && today >= out.fertile.from && today <= out.fertile.to;
    }
    return out;
  }
  // Only what she chooses to share goes on the status doc her partner can read.
  function publicView(hist, cfgIn, today) {
    const s = summary(hist, cfgIn, today);
    const cur = s.last ? { start: s.last.start } : null;
    if (cur && s.last.end) { cur.end = s.last.end; if (s.last.early) cur.early = true; }
    return {
      cur, periodDays: s.cfg.periodDays,
      soon: s.cfg.shareSoon && s.last ? { from: s.soonFrom, next: s.next } : null,
      fertile: s.cfg.shareFertile && s.fertile ? { from: s.fertile.from, to: s.fertile.to } : null,
    };
  }
  function publicNow(pub, today) {
    if (!pub || typeof pub !== 'object') return { active: false, day: null, endsOn: null, length: null, soon: false, soonStart: null, soonEnd: null, fertile: false, fertileTo: null };
    const cfg = cfgOf({ periodDays: pub.periodDays });
    const active = !!pub.cur && activeEntry(pub.cur, today, cfg);
    const soon = !active && !!pub.soon && isDay(pub.soon.from) && today >= pub.soon.from && diff(pub.soon.next, today) <= 7;
    const fertile = !active && !!pub.fertile && isDay(pub.fertile.from) && today >= pub.fertile.from && today <= pub.fertile.to;
    const endsOn = active ? effEnd(pub.cur, cfg) : null;
    return {
      active, day: active ? diff(pub.cur.start, today) + 1 : null, endsOn, length: active ? diff(pub.cur.start, endsOn) + 1 : null,
      soon, soonStart: soon ? pub.soon.next : null, soonEnd: soon && isDay(pub.soon.next) ? addDays(pub.soon.next, cfg.periodDays - 1) : null,
      fertile, fertileTo: fertile ? pub.fertile.to : null,
    };
  }
  // One-time history import code: "PL1:" + entries "YYMMDD.L" (start date, length in days) joined by "-".
  // Also accepts lines like "2026-01-13 5". The code is only ever pasted on her phone; it is not stored anywhere else.
  function encodeImport(entries) {
    return 'PL1:' + entries.map(e => e.start.slice(2).replace(/-/g, '') + '.' + (diff(e.start, e.end || e.start) + 1)).join('-');
  }
  function parseImport(code, today) {
    const txt = String(code || '').trim().replace(/^.*#import=/, '').replace(/^PL1[:_]/i, '');
    const out = [], bad = [];
    const toks = txt.match(/\d{4}-\d{2}-\d{2}[\s,;:]+\d{1,2}|\d{6}\.\d{1,2}/g) || [];
    for (const t of toks) {
      let start, len;
      const m1 = /^(\d{4}-\d{2}-\d{2})[\s,;:]+(\d{1,2})$/.exec(t), m2 = /^(\d{2})(\d{2})(\d{2})\.(\d{1,2})$/.exec(t);
      if (m1) { start = m1[1]; len = +m1[2]; } else if (m2) { start = `20${m2[1]}-${m2[2]}-${m2[3]}`; len = +m2[4]; }
      const ok = isDay(start) && addDays(start, 0) === start && len >= 1 && len <= 14 && (!today || start <= today);
      if (ok) out.push({ start, end: addDays(start, len - 1) }); else bad.push(t);
    }
    return { entries: clean(out), bad };
  }
  function importPlan(existing, cfgIn, entries) {
    const merged = clean([...(Array.isArray(existing) ? existing : []).filter(e => !entries.some(n => n.start === (e && e.start))), ...entries]);
    const lens = entries.map(e => diff(e.start, e.end) + 1).sort((a, b) => a - b);
    const median = lens.length ? lens[Math.floor((lens.length - 1) / 2)] : DEFAULTS.periodDays;
    const base = cfgOf(cfgIn);
    const avg = cycleLength(merged, { ...base, cycleAuto: true });
    const cycle = cfgOf({ ...base, periodDays: median, cycleAuto: true, soonDay: avg.avg ? avg.len - 3 : base.soonDay });
    return { merged, cycle, avgCycle: avg.len, avgFrom: avg.n, typicalLength: median };
  }
  const api = { encodeImport, parseImport, importPlan, DEFAULTS, LIMITS, cfgOf, addDays, diff, clean, effEnd, activeEntry, summary, publicView, publicNow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PLCycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
