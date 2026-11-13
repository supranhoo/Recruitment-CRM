/** Position status and TAT rules, matching the tracker's formulas and Policy 20.1. */
/**
 * TAT rules are versioned per level (Admin > TAT rules, sheet TAT_Rules): each version has an effective-from date,
 * and a clock uses the rule in force on the day it started. Levels without rules fall back to M_Grades.
 */
const TAT_LEVELS_ = ['W1', 'W2', 'W3', 'W4', 'W5', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'T', 'T1', 'T2', 'T3', 'T4'];
const TAT_BASE_EFF_ = '1900-01-01';
const TAT_STORED_ = ['Position_Status', 'Standard_TAT', 'Exemption_Days', 'Final_TAT', 'TAT_End_Date', 'Days_Taken', 'TAT_Result'];
function tatContext_() {
  const grades = {};
  readTable_('M_Grades').rows.forEach(function (g) { grades[String(g.Grade).trim().toUpperCase()] = Number(g.Standard_TAT_Days) || 50; });
  const s = settings_(), grace = Number(s.NOTICE_GRACE_DAYS) || 30, risk = Number(s.TAT_AT_RISK_PCT) || 0.8;
  return { grades: grades, riskPct: risk, grace: grace, rules: tatRulesMap_(grace, risk), today: ymd_(new Date()), exempt: exemptIndex_() };
}
function tatRulesMap_(grace, risk) {
  const rules = {};
  if (!ss_().getSheetByName('TAT_Rules')) return rules;
  readTable_('TAT_Rules').rows.forEach(function (r) {
    if (String(r.Status || 'Active') !== 'Active' || !String(r.Level || '').trim()) return;
    const lv = String(r.Level).trim().toUpperCase();
    (rules[lv] = rules[lv] || []).push({ eff: ymd_(r.Effective_From) || TAT_BASE_EFF_, std: Number(r.Standard_Days) || 0,
      grace: r.Grace_Days === '' || r.Grace_Days == null ? grace : Number(r.Grace_Days), risk: Number(r.Risk_Pct) || risk, version: String(r.Version_ID || '') });
  });
  Object.keys(rules).forEach(function (k) { rules[k].sort(function (a, b) { return a.eff < b.eff ? -1 : a.eff > b.eff ? 1 : 0; }); });
  return rules;
}
/** The rule for a grade on a given start date: the latest version effective on or before that date. */
function ruleFor_(ctx, grade, start) {
  const lv = String(grade || '').trim().toUpperCase();
  const list = ctx.rules && (ctx.rules[lv] || (/^T\d$/.test(lv) ? ctx.rules.T : null));
  if (list && list.length) {
    const d = start || ctx.today; let pick = list[0];
    list.forEach(function (r) { if (r.eff <= d) pick = r; });
    return pick;
  }
  return { eff: '', std: ctx.grades[lv] || 50, grace: ctx.grace, risk: ctx.riskPct, version: '' };
}
/** Only the computed columns that are stored on the position row. */
function storedTat_(c) { const o = {}; TAT_STORED_.forEach(function (k) { o[k] = c[k]; }); return o; }
/** Leadership views (Overview, weekly email) read the Position clock, which runs from MRF approval. */
function orgTat_(l) {
  return Object.assign({}, l, { Standard_TAT: l.Pos_Standard_TAT, Exemption_Days: l.Pos_Exemption_Days, Final_TAT: l.Pos_Final_TAT, Days_Taken: l.Pos_Days_Taken, TAT_Result: l.Pos_TAT_Result });
}

function daysBetween_(a, b) {
  const pa = String(a).split('-'), pb = String(b).split('-');
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function positionStatus_(l) {
  if (String(l.Replaced_By || '').trim()) return 'Replaced';
  const a = String(l.Approval_Status || '').trim().toUpperCase();
  if (a === 'CREATED IN ERROR') return 'Removed';
  if (a === 'NO VACANCY') return 'No Vacancy';
  if (a === 'NOT NEEDED') return 'Not Needed';
  if (a === 'ON HOLD') return 'On Hold';
  if (a === 'APPROVED') {
    if (String(l.Fill_Type || '') === 'Internal') { const e = l.Internal_Effective_Date instanceof Date ? ymd_(l.Internal_Effective_Date) : ''; return e && e <= ymd_(new Date()) ? 'Closed' : 'Offered'; }
    if (String(l.Offer_Sent).toUpperCase() !== 'YES') return 'Open';
    return l.Actual_DOJ ? 'Closed' : 'Offered';
  }
  return '';
}

/** Recruiter clock: from the position assigned date; falls back to the MRF approved date, then the MRF received date. */
function tatStart_(l) {
  const carried = ymd_(l.TAT_Start_From), asg = ymd_(l.Assigned_On);
  if (carried && asg) return asg > carried ? asg : carried;   // v179: a handover on a replacement restarts the recruiter's clock, like any reassignment
  return carried || asg || ymd_(l.Approved_On) || ymd_(l.Receipt_Date);
}
/** Which date the recruiter clock starts from: 'carried' (the original MRF's start), 'assigned', 'approved' or 'received'. */
function tatStartBasis_(l) {
  const carried = ymd_(l.TAT_Start_From), asg = ymd_(l.Assigned_On);
  if (carried && (!asg || asg <= carried)) return 'carried';
  if (asg) return 'assigned';
  return ymd_(l.Approved_On) ? 'approved' : 'received';
}
/** Position clock (TA Lead, Head of HR, Admin views): from the MRF approved date, else the MRF received date. */
function posStart_(l) {   // a replacement carries the original's start (policy 9.5); the recruiter clock restarts at a handover (tatStart_, ADR-081)
  return ymd_(l.TAT_Start_From) || ymd_(l.Approved_On) || ymd_(l.Receipt_Date);
}

/** The offer date of a position, when an offer was sent ('' otherwise). */
function tatOffer_(l) {
  return String(l.Offer_Sent || '').toUpperCase() === 'YES' ? ymd_(l.Offer_Date) : '';
}
/**
 * Allowed days of one clock (v152). base = target days + approved exemption days; noticeExt = notice beyond the grace,
 * always added (v151); notice = the full notice period; hold and paused = days not counted.
 * Today's rule: allowed = base + noticeExt. When the offer went out on or before the offer deadline (start + base + hold
 * + paused: the TAT without the notice), the notice runs from the offer: the clock falls due on the later of today's due
 * date and the offer date + the full notice period. A late offer or no offer keeps today's rule, and the result is never
 * less than today's. Worked in days from the start, so on-hold and paused days move both dates exactly as before.
 * byOffer = the notice from the offer gave more time than today's rule.
 */
function tatAllowed_(start, base, noticeExt, notice, hold, paused, offer) {
  const plain = base + noticeExt;
  if (!start || !offer) return { allowed: plain, byOffer: false };
  const off = daysBetween_(start, offer);
  if (off > base + hold + paused) return { allowed: plain, byOffer: false };   // offered after the TAT: today's rule
  const fromOffer = off + (Number(notice) || 0) - hold - paused;
  return fromOffer > plain ? { allowed: fromOffer, byOffer: true } : { allowed: plain, byOffer: false };
}

/**
 * One clock. Allowed = standard days + notice days above the grace (always, v151) + approved extra days that apply to
 * this clock ('r' recruiter, 'p' position); when the offer went out within the TAT, the notice runs from the offer
 * (v152, `tatAllowed_`). Days taken exclude on-hold days and approved paused days (a paused day already on hold counts once).
 */
function tatClock_(l, ctx, start, status, end, which) {
  const rule = ruleFor_(ctx, l.Grade, start);
  const ex = exemptFor_(ctx, l, which || 'r'), notice = noticeExt_(l, rule.grace);
  const hold = Number(l.Hold_Days) || 0, stop = end || ctx.today;
  const paused = start ? pausedDays_(l, ex.pauses, start, stop) : 0;
  const offer = tatOffer_(l), a = tatAllowed_(start, rule.std + ex.days, notice, Number(l.Notice_Period_Days) || 0, hold, paused, offer);
  const fin = a.allowed, exemption = fin - rule.std;
  const days = start ? Math.max(0, daysBetween_(start, stop) - hold - paused) : '';
  let result = '';
  if (days !== '') {
    if (status === 'Removed' || status === 'No Vacancy' || status === 'Not Needed' || status === 'On Hold') result = '';   // closed without a hire: no achieved or missed
    else if (status === 'Open' || status === 'Offered') result = days > fin ? 'Overdue' : (days >= rule.risk * fin ? 'At risk' : 'On track');
    else if (status === 'Replaced') result = 'Replaced';
    else result = days > fin ? 'Missed' : 'Achieved';
  }
  return { std: rule.std, exemption: exemption, fin: fin, days: days, result: result, version: rule.version, risk: rule.risk,
    notice: notice, extra: ex.days, paused: paused, reasons: ex.reasons, byOffer: a.byOffer, offer: a.byOffer ? offer : '' };
}

/** Returns the computed fields for one position line: the recruiter clock (stored) and the position clock (Pos_*). */
function computeTat_(l, ctx) {
  const status = positionStatus_(l);
  let end = ymd_(l.Actual_DOJ);
  if (!end && status === 'Closed' && String(l.Fill_Type || '') === 'Internal') end = ymd_(l.Internal_Effective_Date);
  if (!end && status === 'No Vacancy') end = ymd_(l.No_Vacancy_Date);
  if (!end && (status === 'Not Needed' || status === 'On Hold')) end = ymd_(l.Not_Needed_Date);
  if (status === 'Replaced') end = ymd_(l.Replaced_On) || ymd_(l.Backout_Date) || end;
  if (status === 'Removed') end = ymd_(l.Not_Needed_Date) || end;
  const rs = tatStart_(l), ps = posStart_(l);
  const r = tatClock_(l, ctx, rs, status, end, 'r'), p = tatClock_(l, ctx, ps, status, end, 'p');
  return { Position_Status: status, Standard_TAT: r.std, Exemption_Days: r.exemption, Final_TAT: r.fin,
    TAT_End_Date: end ? parseYmd_(end) : '', Days_Taken: r.days, TAT_Result: r.result, TAT_Rule: r.version, TAT_Risk: r.risk,
    Pos_TAT_Start: ps, Pos_Standard_TAT: p.std, Pos_Exemption_Days: p.exemption, Pos_Final_TAT: p.fin, Pos_Days_Taken: p.days, Pos_TAT_Result: p.result, Pos_TAT_Rule: p.version,
    Notice_Ext_Days: r.notice, Exempt_Extra_Days: r.extra, Paused_Days: r.paused, Exempt_Reasons: r.reasons.join('; '),
    Pos_Exempt_Extra_Days: p.extra, Pos_Paused_Days: p.paused, Pos_Exempt_Reasons: p.reasons.join('; '),
    Notice_From_Offer: r.offer, Pos_Notice_From_Offer: p.offer };   // the offer date when the notice runs from the offer (v152), else ''
}
