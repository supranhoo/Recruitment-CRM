/**
 * CTC calculator. The salary logic is data: each version of the rules is one row of the CTC_Rules sheet holding the
 * whole structure as JSON (components, choices, rates, caps, slabs, letter notes). Versions are never overwritten;
 * every version records who made it, when, the reason and a remark. Version 1 reproduces the "CTC Calculator"
 * sheet of New_CTC_Structure.xlsx exactly.
 *
 * The engine (ctcEngine_) is one self-contained function. The server runs it, and Index.html embeds the same
 * source for the page (ctcEngineScript_), so the figures on screen and the figures saved can never differ.
 */
const CTC_RULES_ = 'CTC_Rules';
const CTC_RULE_COLS_ = ['Version_ID', 'Effective_From', 'Status', 'Config_JSON', 'Reason', 'Remark', 'Change_Summary',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At', 'Activated_By', 'Activated_At'];
const CTC_REASONS_ = ['Statutory change', 'Company policy change', 'Correction', 'Initial setup', 'Other'];
/** Saved calculations. A Draft can be replaced by its maker; an Issued one is never changed (a re-run makes a new record). */
const CTC_CALCS_ = { name: 'CTC_Calcs', id: 'Calc_ID', prefix: 'CTC-', width: 5, dates: [], editable: [] };
const CTC_CALC_COLS_ = ['Calc_ID', 'Status', 'Name', 'Designation', 'Grade', 'Basis', 'Target', 'Total_CTC', 'Gross', 'Net', 'Rule_Version',
  'Inputs_JSON', 'Result_JSON', 'Language', 'Letter_File', 'Rerun_Of', 'Superseded_By', 'Issued_By', 'Issued_At', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const CTC_LANGS_ = ['en', 'hi', 'both'];

/* ---------------------------------------------------------------- engine (shared with the page) ------------ */

function ctcEngine_() {
  const BASES = { gross: 1, gross_ctc: 1, total_ctc: 1 };
  const SECTIONS = ['earning', 'deduction', 'employer', 'annual'];
  const BASIS_KEY = { total_ctc: 'totalCtc', gross_ctc: 'grossCtc', gross: 'gross', net: 'net' };
  const CAP = 4194303;

  /* Excel ROUND / ROUNDUP (away from zero), after removing binary noise such as 0.4999999999. */
  function clean(x) { return Math.round(x * 1e6) / 1e6; }
  function xround(x) { const a = clean(Math.abs(x)); return (x < 0 ? -1 : 1) * Math.floor(a + 0.5) || 0; }
  function xroundup(x) { const a = clean(Math.abs(x)); return (x < 0 ? -1 : 1) * Math.ceil(a) || 0; }

  function test(v, op, n) {
    return op === '>' ? v > n : op === '>=' ? v >= n : op === '<' ? v < n : op === '<=' ? v <= n : op === '=' ? v === n : true;
  }
  function baseOf(base, vals, ctx) {
    const list = Array.isArray(base) ? base : [base];
    return list.reduce(function (s, b) { return s + (BASES[b] ? (ctx[b] || 0) : (vals[b] || 0)); }, 0);
  }
  function holds(when, vals, ctx) {
    if (!when) return true;
    return test(baseOf(when.of || 'gross', vals, ctx), when.op, Number(when.value));
  }
  function codeOf(cfg, inp, flag) {
    const f = cfg.flags[flag] || {};
    const v = inp.codes && inp.codes[flag] !== undefined && inp.codes[flag] !== '' ? inp.codes[flag] : f.default;
    return v === undefined || v === null ? '' : String(v);
  }
  /** One component's monthly amount. */
  function evalComp(cfg, c, inp, vals, ctx) {
    const rnd = c.round === 'up' ? xroundup : xround;
    if (c.kind === 'input') return xround(Number((inp.amounts || {})[c.id]) || 0);
    if (c.kind === 'fixed') return holds(c.when, vals, ctx) ? Number(c.amount) || 0 : 0;
    if (c.kind === 'pct') return holds(c.when, vals, ctx) ? rnd(baseOf(c.of, vals, ctx) * c.pct / 100) : 0;
    if (c.kind === 'choice') {
      const code = codeOf(cfg, inp, c.flag);
      const o = (c.values || {})[code];
      if (!o || !holds(o.when, vals, ctx)) return 0;
      if (o.amount !== undefined) return rnd(Number(o.amount) || 0);
      let x = baseOf(o.base, vals, ctx) * o.pct / 100;
      if (o.cap !== undefined && o.cap !== null && o.cap !== '') x = Math.min(x, Number(o.cap));
      return rnd(x);
    }
    if (c.kind === 'slab') {
      if (!holds(c.when, vals, ctx)) return 0;
      const v = baseOf(c.of || 'gross', vals, ctx), code = c.flag ? codeOf(cfg, inp, c.flag) : '';
      const s = (c.slabs || []).filter(function (r) { return r.upto === null || r.upto === undefined || r.upto === '' || v <= Number(r.upto); })[0];
      if (!s) return 0;
      const a = typeof s.amount === 'object' && s.amount !== null ? s.amount[code] : s.amount;
      return rnd(Number(a) || 0);
    }
    return 0;
  }
  function uses(cfg, inp, base) {
    return cfg.components.some(function (c) {
      if (c.section !== 'earning' || c.kind !== 'choice') return false;
      const o = (c.values || {})[codeOf(cfg, inp, c.flag)];
      return o && [].concat(o.base || []).indexOf(base) >= 0;
    });
  }

  /**
   * The structure for a Gross entry G. T is the Total CTC that Basic is taken from when Basic is a share of the
   * CTC (the sheet's F4); it is ignored otherwise.
   */
  function structure(cfg, inp, G, T) {
    const vals = {}, ctx = { gross: G, total_ctc: T || 0 };
    const bySec = {}; SECTIONS.forEach(function (s) { bySec[s] = cfg.components.filter(function (c) { return c.section === s; }); });
    let bal = null, sum = 0;
    bySec.earning.forEach(function (c) {
      if (c.kind === 'balancing') { bal = c; return; }
      vals[c.id] = evalComp(cfg, c, inp, vals, ctx); sum += vals[c.id];
    });
    if (bal) { vals[bal.id] = xround(G - sum); sum += vals[bal.id]; }
    const gross = sum; ctx.gross = gross;
    const tot = function (s) { return bySec[s].reduce(function (a, c) { vals[c.id] = evalComp(cfg, c, inp, vals, ctx); return a + vals[c.id]; }, 0); };
    const ded = tot('deduction'), net = gross - ded;
    const er = tot('employer'), grossCtc = gross + er; ctx.gross_ctc = grossCtc;
    const ann = tot('annual'), totalCtc = grossCtc + ann;
    return { values: vals, gross: gross, deductions: ded, net: net, employer: er, grossCtc: grossCtc, annual: ann, totalCtc: totalCtc };
  }

  /** Settles Total CTC and Basic when Basic depends on the CTC (sheet: Solver blocks 1-8). */
  function settle(cfg, inp, G) {
    if (!uses(cfg, inp, 'total_ctc')) { const r0 = structure(cfg, inp, G, 0); r0.settled = true; r0.ctcUsed = r0.totalCtc; return r0; }
    let T = Math.round(G * 1.15), r = null;
    const seen = {};
    for (let i = 0; i < 80; i++) {
      r = structure(cfg, inp, G, T);
      if (r.totalCtc === T) { r.settled = true; r.ctcUsed = T; return r; }
      if (seen[r.totalCtc]) break;
      seen[T] = true; T = r.totalCtc;
    }
    /* Rounding makes Basic and CTC flip between two values: take the one whose gap is smallest. */
    let best = null;
    for (let d = -3; d <= 3; d++) {
      const x = structure(cfg, inp, G, T + d);
      if (!best || Math.abs(x.totalCtc - (T + d)) < Math.abs(best.totalCtc - best.ctcUsed)) { best = x; best.ctcUsed = T + d; }
    }
    best.settled = best.totalCtc === best.ctcUsed;
    return best;
  }

  /** Gross bands: every gross threshold in the rules starts a new band (sheet: Solver J9:L22). */
  function bands(cfg) {
    const starts = { 0: 1 };
    const add = function (w) {
      if (!w || (w.of && w.of !== 'gross')) return;
      const n = Number(w.value);
      if (!isFinite(n)) return;
      starts[w.op === '>' || w.op === '<=' ? n + 1 : n] = 1;
    };
    cfg.components.forEach(function (c) {
      add(c.when);
      if (c.kind === 'slab' && (!c.of || c.of === 'gross')) (c.slabs || []).forEach(function (s) { if (s.upto !== null && s.upto !== undefined && s.upto !== '') starts[Number(s.upto) + 1] = 1; });
      Object.keys(c.values || {}).forEach(function (k) { add(c.values[k].when); });
    });
    /* A ceiling on Basic becomes a gross threshold wherever Basic is a share of the gross. */
    const basic = cfg.components.filter(function (c) { return c.id === 'basic'; })[0];
    const shares = basic ? Object.keys(basic.values || {}).map(function (k) { return basic.values[k]; })
      .filter(function (o) { return [].concat(o.base || []).join() === 'gross' && o.pct; }).map(function (o) { return o.pct / 100; }) : [];
    cfg.components.forEach(function (c) {
      Object.keys(c.values || {}).forEach(function (k) {
        const w = c.values[k].when;
        if (w && w.of === 'basic') shares.forEach(function (p) { starts[Math.floor(Number(w.value) / p) + (w.op === '<' ? 0 : 1)] = 1; });
      });
    });
    const s = Object.keys(starts).map(Number).filter(function (n) { return n >= 0 && n <= CAP; }).sort(function (a, b) { return a - b; });
    return s.map(function (lo, i) { return [lo, i + 1 < s.length ? s[i + 1] - 1 : CAP]; });
  }

  /**
   * Finds the Gross that meets the target on the chosen basis. CTC, Gross CTC and Gross targets take the highest
   * Gross that does not exceed the target; a Net target takes the lowest Gross that gives at least the target.
   */
  function solve(cfg, inp) {
    const basis = BASIS_KEY[inp.basis] ? inp.basis : 'gross';
    const key = BASIS_KEY[basis], target = xround(Number(inp.target) || 0);
    const memo = {};
    const at = function (g) { return memo[g] || (memo[g] = settle(cfg, inp, g)); };
    const val = function (g) { return at(g)[key]; };
    const bs = bands(cfg);
    let G;
    if (basis === 'net') {
      let b = bs.filter(function (x) { return val(x[1]) >= target; })[0] || bs[bs.length - 1];
      let lo = b[0], hi = b[1];
      while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (val(m) >= target) hi = m; else lo = m + 1; }
      G = lo;
    } else {
      const ok = bs.filter(function (x) { return val(x[0]) <= target; });
      if (!ok.length) G = 0;
      else {
        const b = ok[ok.length - 1];
        let lo = b[0], hi = b[1];
        while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (val(m) <= target) lo = m; else hi = m - 1; }
        G = lo;
      }
    }
    const r = at(G);
    return report(cfg, inp, r, basis, target, G);
  }

  /** The result as the page and the letter show it. */
  function report(cfg, inp, r, basis, target, G) {
    const achieved = r[BASIS_KEY[basis]];
    const lines = cfg.components.map(function (c) {
      const m = r.values[c.id] || 0;
      return { id: c.id, label: c.label, section: c.section, monthly: m, yearly: m * 12 };
    });
    const status = !r.settled ? 'unsettled' : achieved === target ? 'exact' : 'nearest';
    const notes = [];
    const g = r.gross;
    /* Plain-language reasons for items that came out as nil, e.g. ESIC above the ceiling. */
    (cfg.explain || []).forEach(function (e) {
      if (e.of && r.values[e.of]) return;
      if (e.flag && codeOf(cfg, inp, e.flag) === '0') return;
      if (e.ifGross && !test(g, e.ifGross.op, Number(e.ifGross.value))) return;
      notes.push(e.text);
    });
    const warnings = cfg.components.filter(function (c) { return c.kind === 'balancing' && (r.values[c.id] || 0) < 0; }).map(function (c) {
      return c.label + ' comes out negative (' + r.values[c.id] + '): the chosen allowances add up to more than this gross allows. Lower the allowances or raise the target.';
    });
    return {
      basis: basis, target: target, warnings: warnings, achieved: achieved, difference: achieved - target, status: status,
      grossEntry: G, ctcUsed: r.ctcUsed, settled: r.settled,
      totals: { gross: r.gross, deductions: r.deductions, net: r.net, employer: r.employer, grossCtc: r.grossCtc, annual: r.annual, totalCtc: r.totalCtc },
      lines: lines, notes: notes
    };
  }

  /** Checks a rules document before it is saved; returns a list of problems (empty when fine). */
  function validate(cfg) {
    const errs = [];
    if (!cfg || !Array.isArray(cfg.components) || !cfg.flags) return ['The rules are missing components or choices.'];
    const ids = {}, seen = {};
    cfg.components.forEach(function (c) { ids[c.id] = c; });
    const order = [];
    SECTIONS.forEach(function (s) { cfg.components.forEach(function (c) { if (c.section === s) order.push(c); }); });
    let bal = 0;
    order.forEach(function (c) {
      const where = '"' + (c.label || c.id) + '"';
      if (!c.id || !/^[a-z][a-z0-9_]*$/.test(c.id)) errs.push(where + ': the id must be lower-case letters, digits or _.');
      if (SECTIONS.indexOf(c.section) < 0) errs.push(where + ': unknown section.');
      if (['input', 'fixed', 'pct', 'choice', 'slab', 'balancing'].indexOf(c.kind) < 0) errs.push(where + ': unknown kind.');
      if (c.kind === 'balancing') { bal++; if (c.section !== 'earning') errs.push(where + ': only an earning can balance the gross.'); }
      if ((c.kind === 'choice' || (c.kind === 'slab' && c.flag)) && !cfg.flags[c.flag]) errs.push(where + ': its choice "' + c.flag + '" is not defined.');
      const refs = [];
      const addRefs = function (b) { [].concat(b || []).forEach(function (x) { refs.push(x); }); };
      addRefs(c.of); if (c.when) addRefs(c.when.of);
      Object.keys(c.values || {}).forEach(function (k) {
        const o = c.values[k];
        addRefs(o.base); if (o.when) addRefs(o.when.of);
        if (o.amount === undefined && !(o.base && isFinite(Number(o.pct)))) errs.push(where + ', option ' + k + ': give an amount or a base and %.');
        if (o.pct !== undefined && !(Number(o.pct) >= 0 && Number(o.pct) <= 100)) errs.push(where + ', option ' + k + ': % must be 0 to 100.');
      });
      if (c.kind === 'pct' && !(Number(c.pct) >= 0 && Number(c.pct) <= 100)) errs.push(where + ': % must be 0 to 100.');
      if (c.kind === 'slab') {
        const sl = c.slabs || [];
        if (!sl.length) errs.push(where + ': add at least one slab.');
        let prev = -Infinity;
        sl.forEach(function (s, i) {
          const open = s.upto === null || s.upto === undefined || s.upto === '';
          if (open && i !== sl.length - 1) errs.push(where + ': only the last slab can be open-ended.');
          if (!open && !(Number(s.upto) > prev)) errs.push(where + ': slabs must go up in order.');
          if (!open) prev = Number(s.upto);
        });
        if (sl.length && !(sl[sl.length - 1].upto === null || sl[sl.length - 1].upto === undefined || sl[sl.length - 1].upto === '')) errs.push(where + ': the last slab must be open-ended.');
      }
      refs.forEach(function (b) {
        if (BASES[b]) {
          if (b === 'gross_ctc' && c.section !== 'annual') errs.push(where + ': Gross CTC is known only for annual items.');
          if (b === 'total_ctc' && c.id !== 'basic') errs.push(where + ': only Basic can be a share of the Total CTC.');
          return;
        }
        if (!ids[b]) errs.push(where + ': refers to unknown item "' + b + '".');
        else if (!seen[b] || (ids[b].kind === 'balancing' && c.section === 'earning')) errs.push(where + ': refers to "' + (ids[b].label || b) + '", which is worked out after it.');
      });
      seen[c.id] = true;
    });
    if (bal !== 1) errs.push('Exactly one earning must balance the gross (Other allowances).');
    Object.keys(cfg.flags).forEach(function (k) {
      const f = cfg.flags[k];
      if (!f.options || !f.options.length) errs.push('Choice "' + (f.label || k) + '" has no options.');
      else if (f.default !== undefined && !f.options.some(function (o) { return String(o.code) === String(f.default); })) errs.push('Choice "' + (f.label || k) + '": the default is not one of its options.');
    });
    return errs;
  }

  return { solve: solve, structure: structure, settle: settle, bands: bands, validate: validate, round: xround, roundUp: xroundup };
}

/** The engine's source, embedded in Index.html so the page computes exactly like the server. */
function ctcEngineScript_() { return 'var CTC_ENGINE = (' + ctcEngine_.toString() + ')();'; }

/* ---------------------------------------------------------------- version 1: the "CTC Calculator" sheet ----- */

function ctcSeedConfig_() {
  const rs = function (a, b, step) { const o = { 0: { amount: 0 } }; for (let i = a; i <= b; i++) o[i] = { amount: i * (step || 1000) }; return o; };
  const ro = function (a, b, step) { const o = [{ code: 0, label: 'None' }]; for (let i = a; i <= b; i++) o.push({ code: i, label: '₹' + (i * (step || 1000)).toLocaleString('en-IN') }); return o; };
  const g21 = { of: 'gross', op: '<=', value: 21000 }, a21 = { of: 'gross', op: '>', value: 21000 };
  const pfValues = {
    1: { base: ['basic'], pct: 12, cap: 3000 },
    2: { base: ['basic', 'hra', 'conv', 'med', 'other'], pct: 12, cap: 1800 },
    3: { base: ['basic'], pct: 12 },
    4: { base: 'gross', pct: 12 }
  };
  const lta = rs(3, 15); lta[30] = { amount: 30000 };
  const ltaOpts = ro(3, 15).concat([{ code: 30, label: '₹30,000' }]);
  return {
    title: 'CTC structure',
    letter: { company: 'BFCL', heading: 'Salary structure', subheading: 'Compensation details (CTC)', signatory: 'Authorised signatory',
      accept: { en: 'Candidate\u2019s signature', hi: '\u0909\u092e\u094d\u092e\u0940\u0926\u0935\u093e\u0930 \u0915\u0947 \u0939\u0938\u094d\u0924\u093e\u0915\u094d\u0937\u0930' } },
    source: 'New_CTC_Structure.xlsx, sheet "CTC Calculator"',
    basisList: [{ id: 'total_ctc', label: 'Total CTC' }, { id: 'gross_ctc', label: 'Gross CTC' }, { id: 'gross', label: 'Gross salary' }, { id: 'net', label: 'Net (in-hand) salary' }],
    defaultBasis: 'gross',
    sections: { earning: 'Earnings', deduction: 'Deductions', employer: 'Employer contribution', annual: 'Other benefits' },
    flags: {
      basic: { label: 'Basic', group: 'structure', default: 3, options: [{ code: 1, label: '50% of Gross salary' }, { code: 2, label: 'Fixed ₹25,100' }, { code: 3, label: '50% of Total CTC' }, { code: 0, label: 'None (stipend)' }] },
      pf: { label: 'Provident Fund', group: 'structure', default: 1, options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: '12% of Basic, max ₹3,000' },
        { code: 2, label: '12% of Basic + HRA + Conveyance + Medical + Other, max ₹1,800' }, { code: 3, label: '12% of Basic, no ceiling' }, { code: 4, label: '12% of Gross, no ceiling' }] },
      esic: { label: 'ESIC', group: 'structure', default: 0, options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: 'On Gross (when Gross ≤ ₹21,000)' }, { code: 2, label: 'On Basic (when Basic ≤ ₹21,000)' }] },
      nps: { label: 'NPS (employer)', group: 'structure', default: 0, options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: '10% of Basic (old regime)' }, { code: 2, label: '14% of Basic (new regime)' },
        { code: 3, label: '20% of Basic (old regime)' }, { code: 4, label: '28% of Basic (new regime)' }, { code: 5, label: '30% of Basic (old regime)' }, { code: 6, label: '42% of Basic (new regime)' }, { code: 7, label: '70% of Basic (new regime)' }] },
      gratuity: { label: 'Gratuity', group: 'structure', default: 1, options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: '4.81% of Basic' }] },
      bonus: { label: 'Bonus', group: 'structure', default: 2, note: 'Paid only when Gross ≤ ₹21,000', options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: '8.33% of Basic (daily wages)' },
        { code: 2, label: '8.33% of Gross (monthly)' }, { code: 3, label: '5% of Gross CTC (monthly)' }] },
      pli: { label: 'Performance Linked Incentive', group: 'structure', default: 2, note: 'Paid only when Gross > ₹21,000', options: [{ code: 0, label: 'Not applicable' }, { code: 1, label: '5% of Gross CTC' },
        { code: 2, label: '8.33% of Gross salary' }, { code: 3, label: '20% of Gross salary' }] },
      mediclaim: { label: 'Mediclaim category', group: 'structure', default: 'S', options: [{ code: 'S', label: 'Single' }, { code: 'M', label: 'Married' }] },
      meal: { label: 'Meal coupon deduction', group: 'structure', default: 0, options: [{ code: 0, label: 'None' }, { code: 1, label: '₹2,600 a month' }] },
      cea: { label: 'CEA', group: 'allowance', default: 0, options: [{ code: 0, label: 'None' }, { code: 1, label: '₹100' }, { code: 2, label: '₹200' }] },
      hostel: { label: 'Child hostel allowance', group: 'allowance', default: 0, options: ro(5, 15) },
      helper: { label: 'Helper allowance', group: 'allowance', default: 0, options: ro(5, 15) },
      books: { label: 'Books & periodicals', group: 'allowance', default: 0, options: [{ code: 0, label: 'None' }, { code: 1, label: '₹1,000' }, { code: 2, label: '₹2,000' }] },
      uniform: { label: 'Uniform allowance', group: 'allowance', default: 0, options: ro(1, 3) },
      driver: { label: 'Driver allowance', group: 'allowance', default: 0, options: ro(5, 18) },
      fuel: { label: 'Fuel expenses', group: 'allowance', default: 0, options: ro(5, 10) },
      vehicle: { label: 'Vehicle maintenance', group: 'allowance', default: 0, options: ro(3, 5) },
      furnishing: { label: 'Soft furnishing allowance', group: 'allowance', default: 0, options: ro(2, 5) },
      food: { label: 'Food allowance', group: 'allowance', default: 0, options: [{ code: 0, label: 'None' }, { code: 1, label: '₹2,600' }] },
      mobile: { label: 'Mobile telephone', group: 'allowance', default: 0, options: [{ code: 0, label: 'None' }, { code: 1, label: '₹1,000' }] },
      lta: { label: 'LTA', group: 'allowance', default: 0, options: ltaOpts },
      ppa: { label: 'PPA', group: 'allowance', default: 0, options: ro(3, 15) }
    },
    components: [
      { id: 'stipend', label: 'Stipend', section: 'earning', kind: 'input' },
      { id: 'basic', label: 'Basic', section: 'earning', kind: 'choice', flag: 'basic',
        values: { 0: { amount: 0 }, 1: { base: 'gross', pct: 50 }, 2: { amount: 25100 }, 3: { base: 'total_ctc', pct: 50 } } },
      { id: 'hra', label: 'HRA', section: 'earning', kind: 'pct', of: ['basic'], pct: 40 },
      { id: 'conv', label: 'Conveyance', section: 'earning', kind: 'fixed', amount: 1600, when: a21 },
      { id: 'med', label: 'Medical', section: 'earning', kind: 'fixed', amount: 1250, when: a21 },
      { id: 'cea', label: 'CEA', section: 'earning', kind: 'choice', flag: 'cea', values: { 0: { amount: 0 }, 1: { amount: 100 }, 2: { amount: 200 } } },
      { id: 'hostel', label: 'Child hostel allowance', section: 'earning', kind: 'choice', flag: 'hostel', values: rs(5, 15) },
      { id: 'helper', label: 'Helper allowance', section: 'earning', kind: 'choice', flag: 'helper', values: rs(5, 15) },
      { id: 'books', label: 'Books & periodicals', section: 'earning', kind: 'choice', flag: 'books', values: { 0: { amount: 0 }, 1: { amount: 1000 }, 2: { amount: 2000 } } },
      { id: 'uniform', label: 'Uniform allowance', section: 'earning', kind: 'choice', flag: 'uniform', values: rs(1, 3) },
      { id: 'driver', label: 'Driver allowance', section: 'earning', kind: 'choice', flag: 'driver', values: rs(5, 18) },
      { id: 'fuel', label: 'Fuel expenses', section: 'earning', kind: 'choice', flag: 'fuel', values: rs(5, 10) },
      { id: 'vehicle', label: 'Vehicle maintenance', section: 'earning', kind: 'choice', flag: 'vehicle', values: rs(3, 5) },
      { id: 'furnishing', label: 'Soft furnishing allowance', section: 'earning', kind: 'choice', flag: 'furnishing', values: rs(2, 5) },
      { id: 'food', label: 'Food allowance', section: 'earning', kind: 'choice', flag: 'food', values: { 0: { amount: 0 }, 1: { amount: 2600 } } },
      { id: 'mobile', label: 'Mobile telephone', section: 'earning', kind: 'choice', flag: 'mobile', values: { 0: { amount: 0 }, 1: { amount: 1000 } } },
      { id: 'lta', label: 'LTA', section: 'earning', kind: 'choice', flag: 'lta', values: lta },
      { id: 'ppa', label: 'PPA', section: 'earning', kind: 'choice', flag: 'ppa', values: rs(3, 15) },
      { id: 'other', label: 'Other allowances', section: 'earning', kind: 'balancing' },
      { id: 'pf_ee', label: 'Provident Fund', section: 'deduction', kind: 'choice', flag: 'pf', values: pfValues },
      { id: 'esic_ee', label: 'ESIC', section: 'deduction', kind: 'choice', flag: 'esic', round: 'up',
        values: { 1: { base: 'gross', pct: 0.75, when: g21 }, 2: { base: ['basic'], pct: 0.75, when: { of: 'basic', op: '<=', value: 21000 } } } },
      { id: 'meal', label: 'Meal coupon', section: 'deduction', kind: 'choice', flag: 'meal', values: { 0: { amount: 0 }, 1: { amount: 2600 } } },
      { id: 'pt', label: 'Professional Tax', section: 'deduction', kind: 'slab', of: 'gross',
        slabs: [{ upto: 25000, amount: 0 }, { upto: 41666, amount: 100 }, { upto: 66666, amount: 150 }, { upto: 83333, amount: 175 }, { upto: null, amount: 208 }] },
      { id: 'mediclaim', label: 'Mediclaim', section: 'deduction', kind: 'slab', of: 'gross', flag: 'mediclaim', when: { of: 'gross', op: '>=', value: 21000 },
        slabs: [{ upto: 50000, amount: { S: 35, M: 100 } }, { upto: 60000, amount: { S: 55, M: 150 } }, { upto: 70000, amount: { S: 70, M: 200 } },
          { upto: 80000, amount: { S: 105, M: 300 } }, { upto: 90000, amount: { S: 140, M: 400 } }, { upto: 100000, amount: { S: 175, M: 500 } }, { upto: null, amount: { S: 246, M: 763 } }] },
      { id: 'pf_er', label: 'Provident Fund', section: 'employer', kind: 'choice', flag: 'pf', values: pfValues },
      { id: 'esic_er', label: 'ESIC', section: 'employer', kind: 'choice', flag: 'esic', round: 'up',
        values: { 1: { base: 'gross', pct: 3.25, when: g21 }, 2: { base: ['basic'], pct: 3.25, when: { of: 'basic', op: '<=', value: 21000 } } } },
      { id: 'nps', label: 'NPS', section: 'employer', kind: 'choice', flag: 'nps',
        values: { 1: { base: ['basic'], pct: 10 }, 2: { base: ['basic'], pct: 14 }, 3: { base: ['basic'], pct: 20 }, 4: { base: ['basic'], pct: 28 }, 5: { base: ['basic'], pct: 30 }, 6: { base: ['basic'], pct: 42 }, 7: { base: ['basic'], pct: 70 } } },
      { id: 'gratuity', label: 'Gratuity', section: 'annual', kind: 'choice', flag: 'gratuity', values: { 1: { base: ['basic'], pct: 4.81 } } },
      { id: 'bonus', label: 'Bonus', section: 'annual', kind: 'choice', flag: 'bonus',
        values: { 1: { base: ['basic'], pct: 8.33, when: g21 }, 2: { base: 'gross', pct: 8.33, when: g21 }, 3: { base: 'gross_ctc', pct: 5, when: g21 } } },
      { id: 'pli', label: 'Performance Linked Incentive', section: 'annual', kind: 'choice', flag: 'pli',
        values: { 1: { base: 'gross_ctc', pct: 5, when: a21 }, 2: { base: 'gross', pct: 8.33, when: a21 }, 3: { base: 'gross', pct: 20, when: a21 } } }
    ],
    explain: [
      { ifGross: { op: '>', value: 21000 }, of: 'esic_ee', flag: 'esic', text: 'ESIC does not apply: Gross is above ₹21,000.' },
      { ifGross: { op: '<=', value: 21000 }, of: 'pli', flag: 'pli', text: 'No Performance Linked Incentive: it is paid only when Gross is above ₹21,000.' },
      { ifGross: { op: '>', value: 21000 }, of: 'bonus', flag: 'bonus', text: 'No statutory bonus: it is paid only when Gross is ₹21,000 or less.' },
      { ifGross: { op: '<=', value: 21000 }, of: 'conv', text: 'No Conveyance or Medical allowance: they apply only when Gross is above ₹21,000.' },
      { ifGross: { op: '<', value: 21000 }, of: 'mediclaim', text: 'No Mediclaim deduction below a Gross of ₹21,000.' }
    ],
    notes: [
      { id: 'accept', en: 'I have fully understood the salary structure above and I accept it. If the labour laws change in future, the company may change my salary structure without changing the CTC.',
        hi: 'ऊपर लिखी हुई सैलरी स्ट्रक्चर मुझे पूरी तरह से समझ आ गयी है और यह मुझे मंजूर है I अगर भविष्य में अगर लेबर कानून बदलता है तो कंपनी , बिना CTC बदले, मेरी सैलरी स्ट्रक्चर चेंज कर सकती है।' },
      { id: 'pli', when: 'pli', en: 'The Performance Linked Incentive is paid at the time of Durga Puja, provided you are active (have not resigned) on the day it is paid and your annual PMS score is 3 or more.',
        hi: 'Performance Linked Incentive दुर्गा पूजा के समय दिया जाएगा, जब आप PLI मिलने वाले दिन तक सक्रिय (एक्टिव) रहेंगे या रिजाइन नही दिए रहेंगे एवं सालाना PMS स्कोर 3 या उससे अधिक हो ।' },
      { id: 'gratuity', when: 'gratuity', en: 'Gratuity is paid as per the provisions of the Payment of Gratuity Act, 1972.',
        hi: 'ग्रेच्युटी का भुगतान ग्रेच्युटी भुगतान अधिनियम, 1972 के प्रावधानों के अनुसार किया जाएगा।' },
      { id: 'bonus', when: 'bonus', en: 'Bonus is paid as per the provisions of the Payment of Bonus Act, 1965.',
        hi: 'बोनस का भुगतान बोनस भुगतान अधिनियम, 1965 के प्रावधानों के अनुसार किया जाएगा।' },
      { id: 'overtime', en: 'Overtime is paid only to W-grade employees with a gross salary of up to ₹21,000.',
        hi: 'ओवरटाइम केवल W ग्रेड एवं 21000 तक ग्रॉस वेतन वाले कर्मचारियों को हीं मिलेगा।' }
    ]
  };
}

/* ---------------------------------------------------------------- storage ---------------------------------- */

function ctcSchema_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CTC_RULES_);
  if (!sh) {
    sh = ss.insertSheet(CTC_RULES_);
    sh.getRange(1, 1, 1, CTC_RULE_COLS_.length).setValues([CTC_RULE_COLS_]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
    sh.setFrozenRows(1);
  }
  addSheet_(CTC_CALCS_.name, CTC_CALC_COLS_);
  if (sh.getLastRow() > 1) return;
  const now = new Date(), eff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const o = { Version_ID: 'CTC-V1', Effective_From: eff, Status: 'Active', Config_JSON: JSON.stringify(ctcSeedConfig_()), Reason: 'Initial setup',
    Remark: 'Set up from the "CTC Calculator" sheet of New_CTC_Structure.xlsx', Change_Summary: 'First version', Created_By: 'system', Created_At: now,
    Activated_By: 'system', Activated_At: now };
  sh.getRange(2, 1, 1, CTC_RULE_COLS_.length).setValues([CTC_RULE_COLS_.map(function (h) { return o[h]; })]);
  dropStale_(CTC_RULES_);
}

function ctcVersions_() {
  return readTable_(CTC_RULES_, true).rows.map(function (r) {
    return { id: String(r.Version_ID), no: Number(String(r.Version_ID).replace(/\D/g, '')) || 0, eff: ymd_(r.Effective_From), status: String(r.Status || ''),
      reason: String(r.Reason || ''), remark: String(r.Remark || ''), summary: String(r.Change_Summary || ''),
      by: String(r.Created_By || ''), at: r.Created_At instanceof Date ? fmt_(r.Created_At, TZ, 'd MMM yyyy, HH:mm') : '',
      activatedBy: String(r.Activated_By || ''), activatedAt: r.Activated_At instanceof Date ? fmt_(r.Activated_At, TZ, 'd MMM yyyy, HH:mm') : '',
      updatedBy: String(r.Updated_By || ''), updatedAt: r.Updated_At instanceof Date ? fmt_(r.Updated_At, TZ, 'd MMM yyyy, HH:mm') : '',
      json: String(r.Config_JSON || ''), _row: r._row };
  }).sort(function (a, b) { return b.no - a.no; });
}

/** The version in force on a day: the active one with the latest effective date on or before it. */
function ctcActive_(day) {
  const d = day || fmt_(new Date(), TZ, 'yyyy-MM-dd');
  const v = ctcVersions_().filter(function (x) { return x.status === 'Active' && x.eff && x.eff <= d; })
    .sort(function (a, b) { return a.eff < b.eff ? 1 : a.eff > b.eff ? -1 : b.no - a.no; })[0];
  if (!v) throw new Error('No CTC rules are in force yet. Ask the admin to activate a version.');
  return { id: v.id, eff: v.eff, config: JSON.parse(v.json) };
}

function ctcRequire_(u, perm) {
  if (!can_(u, perm)) throw new Error(perm === 'ctc_rules' ? 'Only the admin can change the CTC rules.' : 'You do not have access to the CTC calculator.');
}

/* ---------------------------------------------------------------- API -------------------------------------- */

/** What the calculator page needs: the rules in force and the version history (without the full rules). */
function apiCtcRules() {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  const act = ctcActive_();
  const all = ctcVersions_(), rules = can_(u, 'ctc_rules');
  const versions = all.filter(function (v) { return v.status !== 'Draft' && v.status !== 'Discarded'; }).map(function (v) { const o = Object.assign({}, v); delete o.json; delete o._row; return o; });
  const d = rules ? all.filter(function (v) { return v.status === 'Draft'; })[0] : null;
  const draft = d ? { id: d.id, by: d.by, at: d.at, updatedBy: d.updatedBy, updatedAt: d.updatedAt, config: JSON.parse(d.json), changes: ctcDiff_(act.config, JSON.parse(d.json)) } : null;
  return { canRules: rules, today: fmt_(new Date(), TZ, 'yyyy-MM-dd'), active: act, versions: versions, draft: draft,
    reasons: CTC_REASONS_.filter(function (x) { return x !== 'Initial setup'; }) };
}

/** The server's own calculation on the rules in force (the page shows the same figures live). */
function apiCtcCalc(inp) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  inp = ctcInput_(inp);
  const act = ctcActive_();
  const r = ctcEngine_().solve(act.config, inp);
  r.version = act.id;
  return r;
}

/** Cleans what the page sends: basis, target, choices and optional details (Name, Designation, Grade). */
function ctcInput_(d) {
  d = d || {};
  const basis = ['total_ctc', 'gross_ctc', 'gross', 'net'].indexOf(d.basis) >= 0 ? d.basis : 'gross';
  const target = Number(d.target);
  if (!(target > 0 && target <= 4194303)) throw new Error('Enter a monthly target amount between ₹1 and ₹41,94,303.');
  const codes = {};
  Object.keys(d.codes || {}).forEach(function (k) { if (/^[a-z][a-z0-9_]*$/.test(k)) codes[k] = String(d.codes[k]).slice(0, 10); });
  const amounts = {};
  Object.keys(d.amounts || {}).forEach(function (k) { const n = Number(d.amounts[k]); if (/^[a-z][a-z0-9_]*$/.test(k) && n >= 0 && n < 1e7) amounts[k] = Math.round(n); });
  const txt = function (v, n) { return clean_(String(v || '')).trim().slice(0, n); };
  return { basis: basis, target: Math.round(target), codes: codes, amounts: amounts,
    name: txt(d.name, 120), designation: txt(d.designation, 120), grade: txt(d.grade, 20) };
}

/* ---------------------------------------------------------------- saved calculations and letters ----------- */

function ctcCanSee_(u, r) { return can_(u, 'ctc_view_all') || String(r.Created_By).toLowerCase() === u.email; }
function ctcRow_(id) {
  const r = readTable_(CTC_CALCS_.name).rows.filter(function (x) { return String(x.Calc_ID) === String(id); })[0];
  if (!r) throw new Error('Calculation ' + id + ' was not found.');
  return r;
}
function ctcOut_(r, full) {
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  const o = { id: String(r.Calc_ID), status: String(r.Status), name: String(r.Name || ''), designation: String(r.Designation || ''), grade: String(r.Grade || ''),
    basis: String(r.Basis), target: Number(r.Target) || 0, totalCtc: Number(r.Total_CTC) || 0, gross: Number(r.Gross) || 0, net: Number(r.Net) || 0,
    version: String(r.Rule_Version), language: String(r.Language || ''), letter: String(r.Letter_File || ''), rerunOf: String(r.Rerun_Of || ''),
    supersededBy: String(r.Superseded_By || ''), by: String(r.Created_By || ''), at: at(r.Created_At), day: r.Created_At instanceof Date ? ymd_(r.Created_At) : '',
    issuedBy: String(r.Issued_By || ''), issuedAt: at(r.Issued_At) };
  if (full) { o.inputs = JSON.parse(String(r.Inputs_JSON || '{}')); o.result = JSON.parse(String(r.Result_JSON || '{}')); }
  return o;
}

/**
 * Saves a calculation as a draft on the rules in force (the server works it out again; the page's figures are not
 * trusted). d.id replaces the caller's own draft; d.rerunOf links a re-run of an earlier calculation.
 */
function apiCtcSave(d) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  d = d || {};
  const inp = ctcInput_(d), act = ctcActive_();
  const r = ctcEngine_().solve(act.config, inp);
  if (r.status === 'unsettled') throw new Error('The structure did not settle, so it cannot be saved. Check the Basic choice.');
  if ((r.warnings || []).length) throw new Error(r.warnings[0]);
  const rerunOf = d.rerunOf ? String(d.rerunOf) : '';
  if (rerunOf && !ctcCanSee_(u, ctcRow_(rerunOf))) throw new Error('You can re-run only your own calculations.');
  const patch = { Status: 'Draft', Name: inp.name, Designation: inp.designation, Grade: inp.grade, Basis: inp.basis, Target: inp.target,
    Total_CTC: r.totals.totalCtc, Gross: r.totals.gross, Net: r.totals.net, Rule_Version: act.id,
    Inputs_JSON: JSON.stringify(inp), Result_JSON: JSON.stringify(r), Rerun_Of: rerunOf };
  let rec;
  if (d.id) {
    const old = ctcRow_(d.id);
    if (String(old.Created_By).toLowerCase() !== u.email) throw new Error('Only the person who made this draft can change it.');
    if (String(old.Status) !== 'Draft') throw new Error('Calculation ' + d.id + ' is ' + String(old.Status).toLowerCase() + ' and cannot be changed. Re-run it to make a new one.');
    rec = update_(CTC_CALCS_, d.id, patch, u);
  } else rec = insert_(CTC_CALCS_, patch, u);
  return ctcOut_(rec, true);
}

/**
 * Issues a draft: stores the letter PDF made on the page in Drive and locks the record. The rules must still be the
 * ones it was worked out on. Issuing a re-run marks the calculation it replaces as superseded.
 */
function apiCtcIssue(id, d) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  d = d || {};
  const r = ctcRow_(id);
  if (String(r.Created_By).toLowerCase() !== u.email) throw new Error('Only the person who made this calculation can issue it.');
  if (String(r.Status) !== 'Draft') throw new Error('Calculation ' + id + ' is already ' + String(r.Status).toLowerCase() + '.');
  const act = ctcActive_();
  if (String(r.Rule_Version) !== act.id) throw new Error('The CTC rules changed to ' + act.id + ' after this was saved. Re-run it on the new rules first.');
  const lang = CTC_LANGS_.indexOf(d.language) >= 0 ? d.language : 'en';
  const b64 = String(d.pdf || '');
  if (b64.length < 200 || b64.length > 20 * 1024 * 1024) throw new Error('The letter PDF did not arrive. Try again.');
  const bytes = Utilities.base64Decode(b64);
  if (String.fromCharCode.apply(null, bytes.slice(0, 5)) !== '%PDF-') throw new Error('The letter file is not a PDF.');
  const name = id + ' - ' + (String(r.Name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Salary structure') + '.pdf';
  const file = ctcFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  const rec = update_(CTC_CALCS_, id, { Status: 'Issued', Language: lang, Letter_File: file.getUrl(), Issued_By: u.email, Issued_At: new Date() }, u, function (x) {
    if (String(x.Status) !== 'Draft') throw new Error('Calculation ' + id + ' was issued meanwhile.');
  });
  const prev = String(r.Rerun_Of || '');
  if (prev) {
    try {
      const p = ctcRow_(prev);
      if (String(p.Status) === 'Issued') update_(CTC_CALCS_, prev, { Status: 'Superseded', Superseded_By: id }, u);
    } catch (e) { }
  }
  return ctcOut_(rec, true);
}

/** Drops the caller's own draft (kept in the sheet as Discarded, for the record). */
function apiCtcDiscard(id) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  const r = ctcRow_(id);
  if (String(r.Created_By).toLowerCase() !== u.email) throw new Error('Only the person who made this draft can discard it.');
  if (String(r.Status) !== 'Draft') throw new Error('Only a draft can be discarded.');
  update_(CTC_CALCS_, id, { Status: 'Discarded' }, u);
  return true;
}

/** Saved calculations, newest first: the caller's own, or everyone's with ctc_view_all. */
function apiCtcList(f) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  f = f || {};
  const rows = readTable_(CTC_CALCS_.name).rows.filter(function (r) { return ctcCanSee_(u, r) && (f.discarded || String(r.Status) !== 'Discarded'); })
    .map(function (r) { return ctcOut_(r, false); })
    .sort(function (a, b) { return Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')); });
  return { all: can_(u, 'ctc_view_all'), active: ctcActive_().id, rows: rows.slice(0, 1000) };
}

/** One version's rules (for letters worked out on earlier rules). */
function apiCtcVersion(id) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  const v = ctcVersions_().filter(function (x) { return x.id === String(id); })[0];
  if (!v) throw new Error('Rules version ' + id + ' was not found.');
  return JSON.parse(v.json);
}

function apiCtcGet(id) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_use');
  const r = ctcRow_(id);
  if (!ctcCanSee_(u, r)) throw new Error('You can open only your own calculations.');
  return ctcOut_(r, true);
}

/** Drive folder for issued letters, inside the documents folder. */
function ctcFolder_() {
  const s = settings_();
  if (s.CTC_FOLDER_ID) { try { const f = DriveApp.getFolderById(s.CTC_FOLDER_ID); if (!f.isTrashed()) return f; } catch (e) { } }
  if (!s.CV_FOLDER_ID) throw new Error('The documents folder is not set. Ask the admin to run setup().');
  const parent = DriveApp.getFolderById(s.CV_FOLDER_ID);
  const it = parent.getFoldersByName('CTC letters');
  const folder = it.hasNext() ? it.next() : parent.createFolder('CTC letters');
  setSetting_('CTC_FOLDER_ID', folder.getId(), 'Drive folder for issued CTC letters (PDF)');
  return folder;
}

/* ---------------------------------------------------------------- editing the rules (ctc_rules) ------------ */

/** Checks beyond the engine's: labels, amounts, percentages, letter text. Returns a list of problems. */
function ctcCheck_(cfg) {
  const errs = ctcEngine_().validate(cfg);
  if (errs.length) return errs;
  const num = function (v, where, max) { if (!(typeof v === 'number' && isFinite(v) && v >= 0 && v <= (max || 1e7))) errs.push(where + ': enter a number from 0 to ' + (max || 1e7).toLocaleString('en-IN') + '.'); };
  const txt = function (v, where, n) { if (!String(v || '').trim()) errs.push(where + ': enter the text.'); else if (String(v).length > (n || 80)) errs.push(where + ': keep it under ' + (n || 80) + ' characters.'); };
  cfg.components.forEach(function (c) {
    const w = '"' + (c.label || c.id) + '"';
    txt(c.label, 'An item', 60);
    if (c.kind === 'fixed') num(c.amount, w);
    if (c.when) num(Number(c.when.value) === c.when.value ? c.when.value : NaN, w + ' condition');
    Object.keys(c.values || {}).forEach(function (k) {
      const o = c.values[k], ow = w + ', option ' + k;
      if (o.amount !== undefined) num(o.amount, ow);
      if (o.cap !== undefined && o.cap !== null && o.cap !== '') num(o.cap, ow + ' cap');
      if (o.when) num(Number(o.when.value) === o.when.value ? o.when.value : NaN, ow + ' condition');
    });
    (c.slabs || []).forEach(function (sl, i) {
      const sw = w + ', slab ' + (i + 1);
      if (sl.upto !== null && sl.upto !== undefined && sl.upto !== '') num(sl.upto, sw + ' "up to"');
      if (sl.amount && typeof sl.amount === 'object') Object.keys(sl.amount).forEach(function (k) { num(sl.amount[k], sw + ' (' + k + ')'); });
      else num(sl.amount, sw);
    });
  });
  Object.keys(cfg.flags).forEach(function (k) {
    const f = cfg.flags[k], seen = {};
    txt(f.label, 'A choice', 60);
    f.options.forEach(function (o) { txt(o.label, '"' + f.label + '" option', 80); if (seen[String(o.code)]) errs.push('"' + f.label + '": option code ' + o.code + ' is used twice.'); seen[String(o.code)] = 1; });
  });
  (cfg.notes || []).forEach(function (n, i) { txt(n.en, 'Term ' + (i + 1) + ' (English)', 600); if (n.hi && n.hi.length > 600) errs.push('Term ' + (i + 1) + ' (Hindi): keep it under 600 characters.'); });
  txt((cfg.letter || {}).company, 'Letter: company name', 80);
  txt((cfg.letter || {}).signatory, 'Letter: signatory', 60);
  return errs;
}

/** Readable list of what changed from one rules document to another, e.g. "Conveyance › amount: 1600 → 1800". */
function ctcDiff_(a, b) {
  const labelOf = function (cfg, id) { const c = cfg.components.filter(function (x) { return x.id === id; })[0]; return c ? c.label : id; };
  const flat = function (cfg) {
    const out = {};
    const NAMES = { when: 'condition', op: 'test', pct: '%', upto: 'up to', base: 'of' };
    const put = function (path, v) { out[path.map(function (k) { return NAMES[k] || k; }).join(' \u203a ').replace(' \u203a condition \u203a value', ' \u203a condition').replace(' \u203a condition \u203a test', ' \u203a condition test')] = v; };
    const walk = function (path, v) {
      if (v === null || typeof v !== 'object') { put(path, v); return; }
      if (Array.isArray(v)) { v.forEach(function (x, i) { walk(path.concat([x && x.code !== undefined ? 'option ' + x.code : x && x.id ? x.id : 'item ' + (i + 1)]), x); }); return; }
      Object.keys(v).forEach(function (k) { walk(path.concat([k]), v[k]); });
    };
    const count = {}; cfg.components.forEach(function (c) { count[c.label] = (count[c.label] || 0) + 1; });
    const secName = cfg.sections || {};
    cfg.components.forEach(function (c) {
      const base = [(c.label || c.id) + (count[c.label] > 1 ? ' (' + (secName[c.section] || c.section) + ')' : '')];
      Object.keys(c).forEach(function (k) {
        if (k === 'id' || k === 'section' || k === 'kind' || k === 'flag') return;
        if (k === 'slabs') { (c.slabs || []).forEach(function (sl, i) { walk(base.concat(['slab ' + (i + 1)]), sl); }); return; }
        if (k === 'values') { Object.keys(c.values).forEach(function (code) { walk(base.concat(['option ' + code]), c.values[code]); }); return; }
        walk(base.concat([k]), c[k]);
      });
    });
    Object.keys(cfg.flags).forEach(function (k) { const f = cfg.flags[k]; walk(['Choice: ' + (f.label || k)], { label: f.label, default: f.default, options: f.options, note: f.note }); });
    (cfg.notes || []).forEach(function (n, i) { walk(['Term ' + (n.id || i + 1)], { English: n.en, Hindi: n.hi, 'only when paid': n.when ? labelOf(cfg, n.when) : '' }); });
    (cfg.explain || []).forEach(function (e, i) { put(['Explanation ' + (i + 1)], e.text); });
    walk(['Letter'], cfg.letter || {});
    return out;
  };
  const A = flat(a), B = flat(b), out = [];
  const show = function (v) { return v === undefined || v === '' || v === null ? '(none)' : String(v).length > 60 ? '“' + String(v).slice(0, 57) + '…”' : String(v); };
  const ids = function (cfg) { const o = {}; cfg.components.forEach(function (c) { o[c.id] = c.label; }); return o; };
  const ia = ids(a), ib = ids(b);
  Object.keys(ib).forEach(function (k) { if (!ia[k]) out.push('Added item: ' + ib[k]); });
  Object.keys(ia).forEach(function (k) { if (!ib[k]) out.push('Removed item: ' + ia[k]); });
  const added = {}; Object.keys(ib).forEach(function (k) { if (!ia[k]) added[ib[k]] = 1; });
  const gone = {}; Object.keys(ia).forEach(function (k) { if (!ib[k]) gone[ia[k]] = 1; });
  const skip = function (p) { const head = p.split(' › ')[0]; return added[head] || gone[head] || /^Choice: /.test(head) && (added[head.slice(8)] || gone[head.slice(8)]); };
  const keys = {}; Object.keys(A).concat(Object.keys(B)).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) {
    if (skip(k) || String(A[k]) === String(B[k])) return;
    out.push(k + ': ' + show(A[k]) + ' → ' + show(B[k]));
  });
  return out;
}

function ctcRulesRow_(id) {
  const v = ctcVersions_().filter(function (x) { return x.id === String(id); })[0];
  if (!v) throw new Error('Rules version ' + id + ' was not found.');
  return v;
}
function ctcSetRow_(v, patch) {
  const sh = sheet_(CTC_RULES_);
  const heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  Object.keys(patch).forEach(function (k) { const c = heads.indexOf(k); if (c >= 0) sh.getRange(v._row, c + 1).setValue(patch[k]); });
  dropStale_(CTC_RULES_);
}

/** Starts a new version as a draft copy of the rules in force (one draft at a time). */
function apiCtcDraftNew() {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_rules');
  const id = withLock_(function () {
    const all = ctcVersions_();
    const open = all.filter(function (v) { return v.status === 'Draft'; })[0];
    if (open) throw new Error('Version ' + open.id + ' is already being drafted by ' + open.by + '. Continue that one or discard it first.');
    const act = ctcActive_();
    const vid = 'CTC-V' + (all.reduce(function (m, v) { return Math.max(m, v.no); }, 0) + 1), now = new Date();
    const o = { Version_ID: vid, Status: 'Draft', Config_JSON: JSON.stringify(act.config), Change_Summary: 'Draft copied from ' + act.id, Created_By: u.email, Created_At: now, Updated_By: u.email, Updated_At: now };
    const sh = sheet_(CTC_RULES_), heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    sh.getRange(sh.getLastRow() + 1, 1, 1, heads.length).setValues([heads.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    dropStale_(CTC_RULES_);
    return vid;
  });
  audit_(u, CTC_RULES_, id, 'Create', 'draft', '', 'copied from ' + ctcActive_().id);
  return apiCtcRules();
}

/** Saves the draft's rules after checking them; returns the problems (nothing is saved if any) and the changes so far. */
function apiCtcDraftSave(id, cfg) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_rules');
  if (!cfg || typeof cfg !== 'object') throw new Error('The rules did not arrive. Try again.');
  const errs = ctcCheck_(cfg);
  if (errs.length) return { saved: false, errors: errs };
  const json = JSON.stringify(cfg);
  if (json.length > 45000) throw new Error('The rules are too long to store in one cell. Remove unused options or shorten texts.');
  const changes = withLock_(function () {
    const v = ctcRulesRow_(id);
    if (v.status !== 'Draft') throw new Error('Version ' + id + ' is ' + v.status.toLowerCase() + ' and can no longer be edited.');
    ctcSetRow_(v, { Config_JSON: json, Updated_By: u.email, Updated_At: new Date() });
    return ctcDiff_(ctcActive_().config, cfg);
  });
  audit_(u, CTC_RULES_, id, 'Update', 'draft', '', changes.length + ' change(s)');
  return { saved: true, errors: [], changes: changes };
}

function apiCtcDraftDiscard(id) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_rules');
  withLock_(function () {
    const v = ctcRulesRow_(id);
    if (v.status !== 'Draft') throw new Error('Only a draft can be discarded.');
    ctcSetRow_(v, { Status: 'Discarded', Updated_By: u.email, Updated_At: new Date() });
  });
  audit_(u, CTC_RULES_, id, 'Update', 'Status', 'Draft', 'Discarded');
  return apiCtcRules();
}

/**
 * Puts a draft in force from a date (today or later: history is never rewritten). The reason and a remark are
 * required; the list of changes against the rules in force is stored with the version.
 */
function apiCtcActivate(id, d) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_rules');
  d = d || {};
  const today = fmt_(new Date(), TZ, 'yyyy-MM-dd');
  const eff = ymd_(d.eff);
  if (!eff) throw new Error('Pick the date the new rules take effect.');
  if (eff < today) throw new Error('The rules can take effect from today or a later date, not the past.');
  const reason = String(d.reason || '');
  if (CTC_REASONS_.indexOf(reason) < 0 || reason === 'Initial setup') throw new Error('Choose the reason for the change.');
  const remark = clean_(String(d.remark || '')).trim();
  if (remark.length < 10) throw new Error('Write a remark of at least 10 characters: what changed and why.');
  const res = withLock_(function () {
    const v = ctcRulesRow_(id);
    if (v.status !== 'Draft') throw new Error('Version ' + id + ' is ' + v.status.toLowerCase() + '.');
    const cfg = JSON.parse(v.json), errs = ctcCheck_(cfg);
    if (errs.length) throw new Error('The draft has problems: ' + errs[0]);
    const base = ctcActive_(eff), changes = ctcDiff_(base.config, cfg);
    if (!changes.length) throw new Error('The draft is the same as ' + base.id + '. Change something or discard it.');
    const summary = ('Against ' + base.id + ': ' + changes.join('; ')).slice(0, 45000);
    ctcSetRow_(v, { Status: 'Active', Effective_From: parseYmd_(eff), Reason: reason, Remark: remark.slice(0, 1000), Change_Summary: summary,
      Activated_By: u.email, Activated_At: new Date(), Updated_By: u.email, Updated_At: new Date() });
    return { changes: changes.length, base: base.id };
  });
  audit_(u, CTC_RULES_, id, 'Update', 'Status', 'Draft', 'Active from ' + eff + ' (' + reason + ': ' + remark.slice(0, 200) + ')');
  return apiCtcRules();
}

/** Cancels a version that has not taken effect yet. Versions already in force are never withdrawn: make a new one. */
function apiCtcRetire(id, remark) {
  const u = currentUser_(); ensureSchema_();
  ctcRequire_(u, 'ctc_rules');
  remark = clean_(String(remark || '')).trim();
  if (remark.length < 10) throw new Error('Write a remark of at least 10 characters: why the version is cancelled.');
  const today = fmt_(new Date(), TZ, 'yyyy-MM-dd');
  withLock_(function () {
    const v = ctcRulesRow_(id);
    if (v.status !== 'Active' || !(v.eff > today)) throw new Error('Only a version that has not taken effect yet can be cancelled. To change rules in force, make a new version.');
    ctcSetRow_(v, { Status: 'Retired', Remark: (v.remark + ' | Cancelled: ' + remark).slice(0, 1000), Updated_By: u.email, Updated_At: new Date() });
  });
  audit_(u, CTC_RULES_, id, 'Update', 'Status', 'Active', 'Retired (' + remark.slice(0, 200) + ')');
  return apiCtcRules();
}
